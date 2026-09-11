// Covers the stdio MCP server that backs one seat's four tools: what the model
// is shown, what each call answers, how a missing turn file is refused, and the
// tool call log the harness reads afterwards.
//
// Nothing here starts a process or a pipe. The factory builds the server and an
// in memory client drives it over the real protocol, against a temporary corpus
// and a temporary social directory.

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSeatServer, toolCallLogName, type SeatServerOptions } from "../../../src/mcp/seat-server.js";
import { seatToolDefinitions } from "../../../src/seat/tools.js";
import { readInbox } from "../../../src/social/social-store.js";
import { RecordedWorld } from "../../../src/world/recorded-world.js";

// A recorded output long enough to be truncated in the log.
const longOutput = "E".repeat(5000);

let directory = "";
let corpusDirectory = "";
let socialDirectory = "";
let stateFile = "";

// One recorded turn, carrying the inspect calls the fixture holds for it.
function recordedTurn(
  turn: number,
  calls: Array<{ subject: string; output: string }>
): Record<string, unknown> {
  return {
    game: "test-game",
    seat: "korea",
    playerID: 0,
    turn,
    session: "ses_korea",
    observation: "TURN " + turn + " (recorded game test-game)",
    toolCalls: calls.map((call) => ({
      tool: "vox-civ_inspect",
      input: { subject: call.subject },
      output: call.output,
      error: null,
      status: "completed"
    })),
    modelText: null,
    decision: "commit"
  };
}

// Write the file the harness writes before each observation.
async function writeState(turn: number, seat = "korea"): Promise<void> {
  await writeFile(stateFile, JSON.stringify({ turn, seat }), "utf8");
}

// Build one seat's server against the fixture and connect an in memory client,
// so a test drives the same path the model does without a process.
async function connectSeatServer(
  overrides: Partial<SeatServerOptions> = {}
): Promise<{ server: McpServer; client: Client }> {
  const world = await RecordedWorld.fromDirectory(corpusDirectory);
  const server = createSeatServer({
    seat: "korea",
    world,
    socialDirectory,
    stateFile,
    ...overrides
  });
  const pair = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "seat-test-client", version: "1.0.0" });
  await Promise.all([server.connect(pair[0]), client.connect(pair[1])]);
  return { server, client };
}

// Call one tool the way the model does and return the text it answered with.
async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<string> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text?: string }>;
  return content.map((block) => block.text ?? "").join("\n");
}

// Read the seat's tool call log, one parsed entry per line.
async function readToolCallLog(): Promise<Array<Record<string, unknown>>> {
  const text = await readFile(path.join(socialDirectory, toolCallLogName), "utf8");
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("the seat MCP server", () => {
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "harness-mcp-"));
    corpusDirectory = path.join(directory, "corpus");
    socialDirectory = path.join(directory, "social");
    stateFile = path.join(directory, "current-turn.json");
    await mkdir(corpusDirectory, { recursive: true });
    const lines = [
      recordedTurn(5, [
        { subject: "self", output: "RECORDED SELF AT TURN 5" },
        { subject: "economy", output: longOutput }
      ]),
      recordedTurn(6, [{ subject: "self", output: "RECORDED SELF AT TURN 6" }])
    ];
    await writeFile(
      path.join(corpusDirectory, "korea.jsonl"),
      lines.map((line) => JSON.stringify(line) + "\n").join(""),
      "utf8"
    );
    await writeState(5);
  });

  afterEach(async () => {
    if (directory !== "") await rm(directory, { recursive: true, force: true });
  });

  it("should publish exactly the four tools, with the schemas from the definitions", async () => {
    const { client } = await connectSeatServer();

    const listed = await client.listTools();

    expect(listed.tools.map((tool) => tool.name)).toEqual(["inspect", "communicate", "commit_turn", "pass"]);
    for (const tool of listed.tools) {
      const definition = seatToolDefinitions().find((entry) => entry.name === tool.name);
      expect(tool.description).toBe(definition?.description);
      const advertised = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
      const published = definition?.inputSchema as { properties: Record<string, unknown>; required?: string[] };
      expect(Object.keys(advertised.properties ?? {}).sort()).toEqual(Object.keys(published.properties).sort());
      expect([...(advertised.required ?? [])]).toEqual([...(published.required ?? [])]);
    }
  });

  it("should answer an inspect the recorded turn holds", async () => {
    const { client } = await connectSeatServer();

    expect(await callTool(client, "inspect", { subject: "self" })).toBe("RECORDED SELF AT TURN 5");
  });

  it("should name the gap when the recorded turn does not hold the subject", async () => {
    const { client } = await connectSeatServer();

    const answered = await callTool(client, "inspect", { subject: "military" });

    expect(answered).toContain("does not hold recorded state for inspect(military)");
  });

  it("should answer for the turn the state file names now, not the one at startup", async () => {
    const { client } = await connectSeatServer();
    expect(await callTool(client, "inspect", { subject: "self" })).toBe("RECORDED SELF AT TURN 5");

    await writeState(6);

    expect(await callTool(client, "inspect", { subject: "self" })).toBe("RECORDED SELF AT TURN 6");
  });

  it("should deliver a world message that a second seat can read", async () => {
    const { client } = await connectSeatServer();

    const answered = await callTool(client, "communicate", {
      operations: [{ kind: "world", message: "greetings from korea" }]
    });
    expect(answered).toContain("\"delivered\": 1");

    const inbox = await readInbox(socialDirectory, "persia");
    expect(inbox.messages.map((entry) => entry.text)).toContain("greetings from korea");
  });

  it("should end the turn on commit_turn and on pass, answered like any other tool", async () => {
    const { client } = await connectSeatServer();

    const committed = await client.callTool({
      name: "commit_turn",
      arguments: { rationale: "Writing first", actions: [{ type: "research", technology: "Writing" }] }
    });
    expect((committed.content as Array<{ text: string }>)[0].text).toContain("Committed at turn 5: research");
    expect(committed.isError ?? false).toBe(false);

    const passed = await client.callTool({ name: "pass", arguments: { rationale: "nothing to change" } });
    expect((passed.content as Array<{ text: string }>)[0].text).toBe("Passed at turn 5 (nothing to change)");
    expect(passed.isError ?? false).toBe(false);
  });

  it("should refuse a tool the seat does not have", async () => {
    const { client } = await connectSeatServer();

    const result = await client.callTool({ name: "teleport", arguments: {} });

    expect(result.isError ?? false).toBe(true);
    expect((result.content as Array<{ text: string }>)[0].text).toContain("teleport not found");
  });

  it("should refuse a call when the state file cannot be read, and record the refusal", async () => {
    const { client } = await connectSeatServer({ stateFile: path.join(directory, "absent.json") });

    const result = await client.callTool({ name: "inspect", arguments: { subject: "self" } });
    const text = (result.content as Array<{ text: string }>)[0].text;

    expect(result.isError ?? false).toBe(true);
    expect(text).toContain("current turn file at " + path.join(directory, "absent.json") + " is missing or unreadable");
    const entries = await readToolCallLog();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ seat: "korea", turn: null, tool: "inspect" });
  });

  it("should record one whole log line per call, one at a time", async () => {
    const { client } = await connectSeatServer();

    await Promise.all([
      callTool(client, "inspect", { subject: "self" }),
      callTool(client, "pass", { rationale: "quiet turn" })
    ]);

    const entries = await readToolCallLog();
    expect(entries).toHaveLength(2);
    const inspected = entries.find((entry) => entry.tool === "inspect");
    expect(inspected).toMatchObject({
      seat: "korea",
      turn: 5,
      tool: "inspect",
      arguments: { subject: "self" },
      result: "RECORDED SELF AT TURN 5"
    });
    expect(new Date(String(entries[0].at)).toISOString()).toBe(entries[0].at);
    expect(entries.map((entry) => entry.tool).sort()).toEqual(["inspect", "pass"]);
  });

  it("should hand the seat the whole answer and keep the log line at the cap", async () => {
    const { client } = await connectSeatServer();

    const answered = await callTool(client, "inspect", { subject: "economy" });
    const entries = await readToolCallLog();

    expect(answered).toHaveLength(longOutput.length);
    expect(entries[0].result).toHaveLength(4000);
  });
});
