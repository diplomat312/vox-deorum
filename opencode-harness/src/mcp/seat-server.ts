// The MCP server that gives one Civilization seat its four tools.
//
// A seat's model connects to this server as the local MCP server "vox-civ" and
// sees exactly the tools that seatToolDefinitions() publishes. Every call lands
// in dispatchSeatTool, which is the same dispatch the in process runtime uses,
// so a simulated turn and a live one answer alike. The schemas are read out of
// those same definitions instead of being written a second time, so what the
// model reads and what the seat may do cannot drift apart.
//
// Two things are deliberately absent. Nothing here writes to the console,
// because stdout carries the MCP protocol and one stray line would corrupt it.
// And the turn is not fixed at startup, because one seat plays many turns
// through one session: the harness writes STATE_FILE before each observation
// and this server reads it again on every call.

import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { dispatchSeatTool, seatToolDefinitions, type SeatContext } from "../seat/tools.js";
import type { World } from "../world/types.js";

// The name the model connects to. OpenCode keys its configuration by this name
// and records the seat's calls as "<name>_<tool>".
export const seatServerName = "vox-civ";

// The version reported to the client.
export const seatServerVersion = "1.0.0";

// The file, inside the social directory, that records what the seat asked for.
export const toolCallLogName = "tool-calls.jsonl";

// How much of an answer one log line keeps. The seat still reads the whole
// text, because the cap is about keeping the log scannable.
export const maxLoggedResultLength = 4000;

// Everything one seat's server needs. All of it is fixed for the life of the
// process except the turn, which comes from the state file on every call.
export interface SeatServerOptions {
  // The seat this server answers for.
  seat: string;
  // The state source the seat reads. A generated game changes every turn, so a
  // caller may hand over a function that builds the world afresh for each call
  // instead of one fixed world.
  world: World | (() => Promise<World>);
  // Directory holding this run's social log and this seat's tool call log.
  socialDirectory: string;
  // Path of the file naming the turn being played.
  stateFile: string;
  // A label for the game. It only decorates the server's own description.
  game?: string;
}

// One line of the tool call log. The harness reads this file to see what the
// model asked for, so a line is written for an answer and a refusal alike.
export interface ToolCallEntry {
  // ISO timestamp of the moment the call was answered.
  at: string;
  // The seat that called.
  seat: string;
  // The turn the call was answered for, or null when no turn could be read.
  turn: number | null;
  // The tool the seat called.
  tool: string;
  // The arguments the seat passed.
  arguments: unknown;
  // The text the seat was handed, truncated when it is long.
  result: string;
}

// The turn the harness last wrote.
interface CurrentTurn {
  // The turn being played.
  turn: number;
  // The seat that turn belongs to.
  seat: string;
}

// Read the file the harness writes before each observation. Anything the file
// cannot answer, so a missing file, unreadable text, or a shape without a turn
// and a seat, reads as null, because a seat must never be handed a guessed turn.
async function readCurrentTurn(stateFile: string): Promise<CurrentTurn | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(stateFile, "utf8"));
    if (parsed === null || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.turn !== "number" || !Number.isFinite(record.turn)) return null;
    if (typeof record.seat !== "string" || record.seat.trim() === "") return null;
    return { turn: Math.trunc(record.turn), seat: record.seat.trim() };
  } catch {
    return null;
  }
}

// Append one line to the seat's tool call log. A long answer is truncated to
// the cap rather than dropped, so every line stays one whole JSON object.
async function appendToolCall(socialDirectory: string, entry: ToolCallEntry): Promise<void> {
  const line = JSON.stringify({ ...entry, result: entry.result.slice(0, maxLoggedResultLength) }) + "\n";
  await mkdir(socialDirectory, { recursive: true });
  await appendFile(path.join(socialDirectory, toolCallLogName), line, "utf8");
}

// Turn one published definition into the schema the model is shown. The
// definitions carry JSON Schema, so it is handed to zod's own reader rather
// than described again here. A definition this reader cannot express fails at
// build time instead of quietly losing a field.
function schemaForTool(inputSchema: Record<string, unknown>): z.ZodType<Record<string, unknown>> {
  const asJsonSchema = inputSchema as Parameters<typeof z.fromJSONSchema>[0];
  return z.fromJSONSchema(asJsonSchema) as z.ZodType<Record<string, unknown>>;
}

// What the seat is told when the harness has not said which turn is being
// played. Refusing is the point: answering for a guessed turn would hand the
// model the wrong game state and record it as if it were real.
function missingTurnMessage(stateFile: string): string {
  return (
    "This call cannot be answered: the current turn file at " +
    stateFile +
    " is missing or unreadable. The harness writes the turn and the seat there before each observation."
  );
}

// Record one call and hand its text back to the seat. A refusal is marked as an
// error so the model and the harness can tell it from an answer, and the log
// line is written before the answer is returned.
async function answer(
  options: SeatServerOptions,
  tool: string,
  args: Record<string, unknown>,
  turn: number | null,
  text: string,
  refused: boolean
): Promise<CallToolResult> {
  await appendToolCall(options.socialDirectory, {
    at: new Date().toISOString(),
    seat: options.seat,
    turn,
    tool,
    arguments: args,
    result: text
  });
  return refused ? { content: [{ type: "text", text }], isError: true } : { content: [{ type: "text", text }] };
}

// Serve one call: read the turn being played, answer from the seat's tools, and
// record what happened. Every path through here writes exactly one log line.
async function serveCall(
  options: SeatServerOptions,
  world: World,
  tool: string,
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const state = await readCurrentTurn(options.stateFile);
  if (state === null) {
    return answer(options, tool, args, null, missingTurnMessage(options.stateFile), true);
  }
  if (state.seat.toLowerCase() !== options.seat.toLowerCase()) {
    const wrongSeat =
      "This call cannot be answered: the current turn file at " +
      options.stateFile +
      " belongs to seat '" +
      state.seat +
      "', and this server answers for '" +
      options.seat +
      "'.";
    return answer(options, tool, args, state.turn, wrongSeat, true);
  }
  const context: SeatContext = {
    seat: options.seat,
    playerID: world.seats().find((entry) => entry.seat === options.seat)?.playerID ?? null,
    turn: state.turn,
    world,
    socialDirectory: options.socialDirectory
  };
  try {
    const result = await dispatchSeatTool(context, tool, args);
    return answer(options, tool, args, state.turn, result.text, false);
  } catch (failure) {
    const message = "The tool failed: " + (failure instanceof Error ? failure.message : String(failure));
    return answer(options, tool, args, state.turn, message, true);
  }
}

// Build the configured server for one seat, so a caller can connect it to a
// transport or to a test client. The four tools come from the shared
// definitions, and every call is served through one queue so two calls in the
// same turn cannot interleave their file writes.
export function createSeatServer(options: SeatServerOptions): McpServer {
  const server = new McpServer({
    name: seatServerName,
    version: seatServerVersion,
    title: options.game ? options.game + " " + options.seat + " seat" : options.seat + " seat"
  });

  // The chain that keeps the seat's calls one at a time. A failed call never
  // breaks the chain, so the seat's next call still runs.
  let tail: Promise<unknown> = Promise.resolve();
  // The world is resolved once per turn, so several calls in one turn share a
  // single read of the game rather than reloading it each time.
  let cachedWorld: World | null = typeof options.world === "function" ? null : options.world;
  let cachedTurn: number | null = null;
  async function worldFor(turn: number): Promise<World> {
    if (cachedWorld && cachedTurn === turn) return cachedWorld;
    cachedWorld = typeof options.world === "function" ? await options.world() : options.world;
    cachedTurn = turn;
    return cachedWorld;
  }
  function enqueue(work: () => Promise<CallToolResult>): Promise<CallToolResult> {
    const run = tail.then(work, work);
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  for (const definition of seatToolDefinitions()) {
    server.registerTool(
      definition.name,
      { description: definition.description, inputSchema: schemaForTool(definition.inputSchema) },
      (args: Record<string, unknown>) =>
        enqueue(async () => {
          const state = await readCurrentTurn(options.stateFile);
          const world = await worldFor(state?.turn ?? -1);
          return serveCall(options, world, definition.name, args ?? {});
        })
    );
  }

  return server;
}
