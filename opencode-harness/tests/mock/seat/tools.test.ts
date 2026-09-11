// Covers the four tools a seat may call: what they answer, what they refuse,
// which ones end the turn, and the gap that is recorded when a seat asks for
// something the simulation does not hold.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dispatchSeatTool, seatToolDefinitions, type SeatContext } from "../../../src/seat/tools.js";
import { RecordedWorld } from "../../../src/world/recorded-world.js";
import type { WorldTurn } from "../../../src/world/types.js";

// A recorded turn for the seat, optionally carrying calls the seat made.
function recordedTurn(overrides: Partial<WorldTurn> = {}): WorldTurn {
  return {
    game: "test-game",
    seat: "korea",
    playerID: 0,
    turn: 5,
    session: "ses_korea",
    observation: "TURN 5 (live game test-game)",
    toolCalls: [],
    modelText: null,
    decision: "commit",
    ...overrides
  };
}

describe("the seat tool surface", () => {
  let directory = "";
  let context: SeatContext;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "harness-seat-"));
    context = {
      seat: "korea",
      playerID: 0,
      turn: 5,
      world: new RecordedWorld([recordedTurn()]),
      socialDirectory: directory
    };
  });

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("should publish exactly the four tools, each with a schema", () => {
    const definitions = seatToolDefinitions();

    expect(definitions.map((tool) => tool.name)).toEqual(["inspect", "communicate", "commit_turn", "pass"]);
    for (const definition of definitions) {
      expect(definition.description.length).toBeGreaterThan(0);
      expect(definition.inputSchema).toHaveProperty("type", "object");
    }
  });

  it("should refuse an inspect with no usable subject", async () => {
    const result = await dispatchSeatTool(context, "inspect", { subject: "weather" });

    expect(result.terminal).toBe(false);
    expect(result.text).toContain("inspect needs a subject");
  });

  it("should answer an inspect the recording holds", async () => {
    context.world = new RecordedWorld([
      recordedTurn({
        toolCalls: [
          {
            tool: "vox-civ_inspect",
            input: { subject: "self" },
            output: "{\"Gold\":120}",
            error: null,
            status: "completed"
          }
        ]
      })
    ]);

    const result = await dispatchSeatTool(context, "inspect", { subject: "self" });

    expect(result.text).toBe("{\"Gold\":120}");
    expect(result.gap).toBeUndefined();
  });

  it("should record a gap when the recording has no answer", async () => {
    const result = await dispatchSeatTool(context, "inspect", { subject: "cities" });

    expect(result.gap).toEqual({ subject: "cities" });
    expect(result.text).toContain("does not hold recorded state");
  });

  it("should distinguish a recorded answer by its detail", async () => {
    context.world = new RecordedWorld([
      recordedTurn({
        toolCalls: [
          {
            tool: "vox-civ_inspect",
            input: { subject: "diplomacy", detail: "siam" },
            output: "siam is friendly",
            error: null,
            status: "completed"
          }
        ]
      })
    ]);

    const matched = await dispatchSeatTool(context, "inspect", { subject: "diplomacy", detail: "siam" });
    const missed = await dispatchSeatTool(context, "inspect", { subject: "diplomacy", detail: "austria" });

    expect(matched.text).toBe("siam is friendly");
    expect(missed.gap).toEqual({ subject: "diplomacy", detail: "austria" });
  });

  it("should answer a recorded failure as a failure", async () => {
    context.world = new RecordedWorld([
      recordedTurn({
        toolCalls: [
          {
            tool: "vox-civ_inspect",
            input: { subject: "military" },
            output: null,
            error: "no units",
            status: "failed"
          }
        ]
      })
    ]);

    const result = await dispatchSeatTool(context, "inspect", { subject: "military" });

    expect(result.text).toContain("inspect failed when it was recorded: no units");
  });

  it("should answer the inbox live rather than from the recording", async () => {
    await dispatchSeatTool(context, "communicate", { operations: [{ kind: "world", message: "hello world" }] });

    const inbox = await dispatchSeatTool(context, "inspect", { subject: "events" });

    expect(inbox.text).toContain("hello world");
    expect(inbox.gap).toBeUndefined();
  });

  it("should refuse an empty communicate", async () => {
    const result = await dispatchSeatTool(context, "communicate", { operations: [] });

    expect(result.text).toContain("at least one operation");
  });

  it("should refuse a direct message to a seat that cannot be seen", async () => {
    const result = await dispatchSeatTool(context, "communicate", {
      operations: [{ kind: "dm", to: "nowhere", message: "hi" }]
    });

    expect(result.text).toContain("communicate was refused");
  });

  it("should end the turn on a commit and keep the actions", async () => {
    const result = await dispatchSeatTool(context, "commit_turn", {
      rationale: "Growth first.",
      actions: [{ type: "research", technology: "Pottery" }]
    });

    expect(result.terminal).toBe(true);
    expect(result.outcome).toBe("committed");
    expect(result.actions).toEqual([{ type: "research", technology: "Pottery" }]);
    expect(result.text).toContain("Committed at turn 5");
  });

  it("should refuse a commit whose action has no usable type", async () => {
    const result = await dispatchSeatTool(context, "commit_turn", { rationale: "", actions: [{ type: "conquest" }] });

    expect(result.terminal).toBe(false);
    expect(result.text).toContain("commit_turn was refused");
  });

  it("should accept an empty commit, which is a seat choosing to do nothing", async () => {
    const result = await dispatchSeatTool(context, "commit_turn", { rationale: "Nothing to change.", actions: [] });

    expect(result.terminal).toBe(true);
    expect(result.actions).toEqual([]);
  });

  it("should end the turn on a pass", async () => {
    const result = await dispatchSeatTool(context, "pass", { rationale: "Quiet turn." });

    expect(result.terminal).toBe(true);
    expect(result.outcome).toBe("passed");
    expect(result.text).toContain("Passed at turn 5");
  });

  it("should refuse a tool outside the surface", async () => {
    const result = await dispatchSeatTool(context, "shell", { command: "ls" });

    expect(result.terminal).toBe(false);
    expect(result.text).toContain("unknown tool 'shell'");
  });
});
