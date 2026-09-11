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

  it("should record what the world refused, not only what the seat asked", async () => {
    const store = new TraceStore(directory, "run-1");
    const world = new RecordedWorld([recordedTurn()]);
    // A world that refuses the second of two actions, which is what a live game
    // does when an action is illegal.
    world.applyDecision = () => [
      { type: "research", taken: true },
      { type: "policy", taken: false, reason: "Policy refused: none was ready" }
    ];
    const runtime = new SeatRuntime({
      client: driverReturning({
        toolCalls: [
          call("commit_turn", {
            rationale: "Expand.",
            actions: [{ type: "research", technology: "Pottery" }, { type: "policy", policy: "Tradition Opener" }]
          })
        ]
      }),
      world,
      socialDirectory,
      store
    });

    const record = await runtime.playTurn("korea", 7);

    // The seat is recorded as having committed both, because that is what it
    // asked for, and the record separately says the world did not take one.
    expect(record.applied).toContain("committed research, policy");
    expect(record.refused).toEqual([{ type: "policy", reason: "Policy refused: none was ready" }]);
  });

  it("should record no refusals when the world took everything", async () => {
    const store = new TraceStore(directory, "run-1");
    const runtime = new SeatRuntime({
      client: driverReturning({
        toolCalls: [call("commit_turn", { rationale: "Growth.", actions: [{ type: "research", technology: "Pottery" }] })]
      }),
      world: new RecordedWorld([recordedTurn()]),
      socialDirectory,
      store
    });

    expect((await runtime.playTurn("korea", 7)).refused).toEqual([]);
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

  it("should ask turn again when it comes back with nothing at all", async () => {
    const store = new TraceStore(directory, "run-1");
    const asked: string[] = [];
    const runtime = new SeatRuntime({
      client: {
        async sendObservation(seat: string, observation: string): Promise<SeatTurnResult> {
          asked.push(observation);
          // The first answer is the shape a dropped request leaves: no text, no
          // thinking, no calls, and zero tokens after twenty-five seconds.
          if (asked.length === 1) {
            return {
              session: seat,
              model: "opencode-go/deepseek-v4.1-flash",
              reasoning: null,
              modelText: null,
              toolCalls: [],
              usage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: 0 },
              latencyMs: 25000,
              unknownParts: []
            } as SeatTurnResult;
          }
          return {
            session: seat,
            model: "opencode-go/deepseek-v4.1-flash",
            reasoning: "Nothing worth changing this turn.",
            modelText: "Holding steady.",
            toolCalls: [call("pass", {})],
            usage,
            latencyMs: 3000,
            unknownParts: []
          } as SeatTurnResult;
        }
      },
      world: new RecordedWorld([recordedTurn()]),
      socialDirectory,
      store
    });

    const record = await runtime.playTurn("korea", 7);

    // The lost request is asked again, and the answer that arrives is the turn.
    expect(asked).toHaveLength(2);
    expect(record.outcome).toBe("passed");
    expect(record.emptyRetries).toBe(1);
    // The time recorded is what the seat spent across both asks, and the retry
    // carries a line of instruction rather than the whole observation again.
    expect(record.latencyMs).toBe(28000);
    expect(asked[1]).toContain("produced no answer");
    expect(asked[1].length).toBeLessThan(300);
  });

  it("should not ask again when the seat answered without deciding", async () => {
    const store = new TraceStore(directory, "run-1");
    let asks = 0;
    const answer = driverReturning({ toolCalls: [call("inspect", { subject: "self" })] });
    const runtime = new SeatRuntime({
      client: {
        async sendObservation(seat: string, observation: string): Promise<SeatTurnResult> {
          asks += 1;
          return answer.sendObservation(seat, observation, 7);
        }
      },
      world: new RecordedWorld([recordedTurn()]),
      socialDirectory,
      store
    });

    const record = await runtime.playTurn("korea", 7);

    // Inspecting and stopping is a real answer, so the seat is not asked twice.
    expect(asks).toBe(1);
    expect(record.outcome).toBe("unfinished");
    expect(record.emptyRetries).toBe(0);
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

  it("should record a reset when the harness repairs a seat mid-run", async () => {
    const store = new TraceStore(directory, "run-1");
    const runtime = new SeatRuntime({
      client: {
        async sendObservation(): Promise<SeatTurnResult> {
          throw new Error("fetch failed");
        }
      },
      world: new RecordedWorld([recordedTurn()]),
      socialDirectory,
      store,
      onTurnFailed: async () => "reset" as const
    });

    const record = await runtime.playTurn("korea", 7);

    expect(record.outcome).toBe("failed");
    expect(record.contextReset).toBe(true);
  });

  it("should keep the session when a failure was not the server going away", async () => {
    const store = new TraceStore(directory, "run-1");
    const runtime = new SeatRuntime({
      client: {
        async sendObservation(): Promise<SeatTurnResult> {
          throw new Error("fetch failed");
        }
      },
      world: new RecordedWorld([recordedTurn()]),
      socialDirectory,
      store,
      onTurnFailed: async () => "none" as const
    });

    expect((await runtime.playTurn("korea", 7)).contextReset).toBe(false);
  });

  it("should keep the seat's context when its stalled work is cleared", async () => {
    const store = new TraceStore(directory, "run-1");
    const runtime = new SeatRuntime({
      client: {
        async sendObservation(): Promise<SeatTurnResult> {
          throw new Error("the turn exceeded 150000ms and was abandoned");
        }
      },
      world: new RecordedWorld([recordedTurn()]),
      socialDirectory,
      store,
      onTurnFailed: async () => "aborted" as const
    });

    const record = await runtime.playTurn("korea", 7);

    expect(record.outcome).toBe("failed");
    // Clearing stalled work is not a reset: the session, its history and its
    // cache all survive, so the run's later cache figures keep their meaning.
    expect(record.contextReset).toBe(false);
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

  it("should read a decision a live tool server already served", async () => {
    const store = new TraceStore(directory, "run-1");
    const runtime = new SeatRuntime({
      client: driverReturning({
        toolCalls: [
          {
            tool: "vox-civ_inspect",
            callID: "call_1",
            status: "completed",
            input: { subject: "cities" },
            output: "The simulation does not hold recorded state for inspect(cities) on this turn.",
            error: null
          },
          call("commit_turn", { rationale: "Expand.", actions: [{ type: "strategy", grand: "tall" }] })
        ]
      }),
      world: new RecordedWorld([recordedTurn()]),
      socialDirectory,
      store,
      toolServing: "observe"
    });

    const record = await runtime.playTurn("korea", 7);

    expect(record.outcome).toBe("committed");
    expect(record.applied).toContain("committed strategy");
    expect(record.applied).toContain("information gaps: cities");
  });

  it("should read a pass a live tool server already served", async () => {
    const store = new TraceStore(directory, "run-1");
    const runtime = new SeatRuntime({
      client: driverReturning({ toolCalls: [call("pass", { rationale: "Nothing." })] }),
      world: new RecordedWorld([recordedTurn()]),
      socialDirectory,
      store,
      toolServing: "observe"
    });

    expect((await runtime.playTurn("korea", 7)).outcome).toBe("passed");
  });
});
