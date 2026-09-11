// Covers one seat playing one turn: what a committed turn records, what a pass
// records, what an unanswered turn records, and the gaps a seat leaves behind
// when it asks for information the simulation does not hold.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SeatRuntime, type SessionDriver } from "../../../src/seat/runtime.js";
import { TraceStore } from "../../../src/trace/store.js";
import { RecordedWorld } from "../../../src/world/recorded-world.js";
import type { SeatTurnResult, SessionToolCall, SessionUsage } from "../../../src/session/types.js";
import type { WorldTurn } from "../../../src/world/types.js";

// Usage numbers for a stubbed response.
const usage: SessionUsage = {
  input: 100,
  output: 20,
  reasoning: 40,
  cacheRead: 900,
  cacheWrite: 0,
  total: 1060,
  cost: 0.02
};

// One recorded turn, so a runtime always has an observation to send.
function recordedTurn(overrides: Partial<WorldTurn> = {}): WorldTurn {
  return {
    game: "fresh4",
    seat: "korea",
    playerID: 0,
    turn: 7,
    session: "ses_korea",
    observation: "TURN 7 (live game fresh4)",
    toolCalls: [],
    modelText: null,
    decision: "commit",
    ...overrides
  };
}

// A session driver that answers with whatever a test hands it.
function driverReturning(result: Partial<SeatTurnResult>): SessionDriver {
  return {
    async sendObservation(seat: string): Promise<SeatTurnResult> {
      return {
        session: "ses_korea",
        model: "opencode-go/deepseek-v4.1-flash",
        reasoning: "Korea needs a coastal city.",
        modelText: "Committing Pottery.",
        toolCalls: [],
        usage,
        latencyMs: 4200,
        unknownParts: [],
        ...result,
        session: seat
      } as SeatTurnResult;
    }
  };
}

// Build one tool call as a session would report it.
function call(tool: string, input: unknown): SessionToolCall {
  return { tool, callID: "call_" + tool, status: "completed", input, output: "{}", error: null };
}

describe("a seat playing a turn", () => {
  let directory = "";
  let socialDirectory = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "harness-run-"));
    socialDirectory = await mkdtemp(path.join(tmpdir(), "harness-social-"));
  });

  afterEach(async () => {
    for (const target of [directory, socialDirectory]) {
      if (target) await rm(target, { recursive: true, force: true });
    }
  });

  it("should record a committed turn with its reasoning and usage", async () => {
    const store = new TraceStore(directory, "run-1");
    const runtime = new SeatRuntime({
      client: driverReturning({
        toolCalls: [call("commit_turn", { rationale: "Growth.", actions: [{ type: "research", technology: "Pottery" }] })]
      }),
      world: new RecordedWorld([recordedTurn()]),
      socialDirectory,
      store
    });

    const record = await runtime.playTurn("korea", 7);

    expect(record.outcome).toBe("committed");
    expect(record.reasoning).toBe("Korea needs a coastal city.");
    expect(record.observation).toBe("TURN 7 (live game fresh4)");
    expect(record.usage.cacheRead).toBe(900);
    expect(record.applied).toContain("committed research");
    expect((await store.readSeat("korea"))).toHaveLength(1);
  });

  it("should record a passed turn", async () => {
    const store = new TraceStore(directory, "run-1");
    const runtime = new SeatRuntime({
      client: driverReturning({ toolCalls: [call("pass", { rationale: "Quiet." })] }),
      world: new RecordedWorld([recordedTurn()]),
      socialDirectory,
      store
    });

    expect((await runtime.playTurn("korea", 7)).outcome).toBe("passed");
  });

  it("should record a turn whose seat never decided", async () => {
    const store = new TraceStore(directory, "run-1");
    const runtime = new SeatRuntime({
      client: driverReturning({ toolCalls: [call("inspect", { subject: "self" })] }),
      world: new RecordedWorld([recordedTurn()]),
      socialDirectory,
      store
    });

    expect((await runtime.playTurn("korea", 7)).outcome).toBe("unfinished");
  });

  it("should note the information a seat asked for and did not get", async () => {
    const store = new TraceStore(directory, "run-1");
    const runtime = new SeatRuntime({
      client: driverReturning({
        toolCalls: [
          call("inspect", { subject: "cities" }),
          call("inspect", { subject: "diplomacy", detail: "siam" }),
          call("pass", {})
        ]
      }),
      world: new RecordedWorld([recordedTurn()]),
      socialDirectory,
      store
    });

    const record = await runtime.playTurn("korea", 7);

    expect(record.outcome).toBe("passed");
    expect(record.applied).toContain("information gaps: cities, diplomacy siam");
  });

  it("should let a seat talk during its turn and see the message was delivered", async () => {
    const store = new TraceStore(directory, "run-1");
    const runtime = new SeatRuntime({
      client: driverReturning({
        toolCalls: [
          call("communicate", { operations: [{ kind: "world", message: "Peace on my borders." }] }),
          call("pass", {})
        ]
      }),
      world: new RecordedWorld([recordedTurn()]),
      socialDirectory,
      store
    });

    const record = await runtime.playTurn("korea", 7);
    const { readInbox } = await import("../../../src/social/social-store.js");
    const other = await readInbox(socialDirectory, "siam");

    expect(record.toolCalls).toHaveLength(2);
    expect(JSON.stringify(other)).toContain("Peace on my borders.");
  });

  it("should record a failed turn without losing the observation", async () => {
    const store = new TraceStore(directory, "run-1");
    const runtime = new SeatRuntime({
      client: {
        async sendObservation(): Promise<SeatTurnResult> {
          throw new Error("the provider went away");
        }
      },
      world: new RecordedWorld([recordedTurn()]),
      socialDirectory,
      store
    });

    const record = await runtime.playTurn("korea", 7);

    expect(record.outcome).toBe("failed");
    expect(record.error).toBe("the provider went away");
    expect(record.observation).toBe("TURN 7 (live game fresh4)");
    expect(record.usage.total).toBe(0);
  });

  it("should refuse to play a turn the world does not hold", async () => {
    const store = new TraceStore(directory, "run-1");
    const runtime = new SeatRuntime({
      client: driverReturning({}),
      world: new RecordedWorld([recordedTurn()]),
      socialDirectory,
      store
    });

    await expect(runtime.playTurn("korea", 99)).rejects.toThrowError(/No recorded turn/);
  });
});
