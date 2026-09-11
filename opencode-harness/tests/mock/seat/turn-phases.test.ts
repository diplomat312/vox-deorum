// Covers the two phases of a turn separately.
//
// The point of the split is that a seat's thinking can be told apart from its
// effects, so a game's clock can be handled differently around each. These tests
// hold that property: deciding must not change the world, and committing must.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SeatRuntime, type SessionDriver } from "../../../src/seat/runtime.js";
import { TraceStore } from "../../../src/trace/store.js";
import { RecordedWorld } from "../../../src/world/recorded-world.js";
import type { SeatTurnResult, SessionToolCall } from "../../../src/session/types.js";
import type { WorldTurn } from "../../../src/world/types.js";

// One recorded turn, so the runtime always has an observation to send.
function recordedTurn(): WorldTurn {
  return {
    game: "sim",
    seat: "korea",
    playerID: 0,
    turn: 4,
    session: "ses_korea",
    observation: "TURN 4 (simulated game sim)",
    toolCalls: [],
    modelText: null,
    decision: "commit"
  };
}

// A driver that answers with a commit of one technology.
function committingDriver(): SessionDriver {
  return {
    async sendObservation(seat: string): Promise<SeatTurnResult> {
      const calls: SessionToolCall[] = [
        {
          tool: "vox-civ_commit_turn",
          callID: "c1",
          status: "completed",
          input: { rationale: "Growth.", actions: [{ type: "research", technology: "Pottery" }] },
          output: null,
          error: null
        }
      ];
      return {
        session: seat,
        model: "test",
        reasoning: "Pottery first.",
        modelText: null,
        toolCalls: calls,
        usage: { input: 10, output: 2, reasoning: 1, cacheRead: 0, cacheWrite: 0, total: 13, cost: null },
        latencyMs: 5,
        unknownParts: []
      };
    }
  };
}

describe("deciding apart from committing", () => {
  let directory = "";
  let socialDirectory = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "harness-split-"));
    socialDirectory = await mkdtemp(path.join(tmpdir(), "harness-split-social-"));
  });

  afterEach(async () => {
    for (const target of [directory, socialDirectory]) {
      if (target) await rm(target, { recursive: true, force: true });
    }
  });

  it("should not touch the world while a seat is thinking", async () => {
    const store = new TraceStore(directory, "run-1");
    const world = new RecordedWorld([recordedTurn()]);
    let applied = 0;
    world.applyDecision = () => {
      applied += 1;
      return [];
    };
    const runtime = new SeatRuntime({ client: committingDriver(), world, socialDirectory, store });

    const pending = await runtime.decideTurn("korea", 4);

    // This is the property the split exists for: a decision that has been
    // reached has had no effect yet.
    expect(applied).toBe(0);
    expect(pending.actions).toEqual([{ type: "research", technology: "Pottery" }]);
    expect(pending.outcome).toBe("committed");
    expect(pending.observation).toBe("TURN 4 (simulated game sim)");
    // Nothing is written down until the decision takes effect.
    expect(await store.readSeat("korea")).toEqual([]);
  });

  it("should make the decision take effect when it is committed", async () => {
    const store = new TraceStore(directory, "run-1");
    const world = new RecordedWorld([recordedTurn()]);
    const asked: Array<Record<string, unknown>> = [];
    world.applyDecision = (_seat, actions) => {
      asked.push(...actions);
      return actions.map((action) => ({ type: String(action.type), taken: true }));
    };
    const runtime = new SeatRuntime({ client: committingDriver(), world, socialDirectory, store });

    const pending = await runtime.decideTurn("korea", 4);
    const record = await runtime.commitTurn(pending);

    expect(asked).toHaveLength(1);
    expect(record.outcome).toBe("committed");
    expect(record.applied).toContain("committed research");
    expect(record.reasoning).toBe("Pottery first.");
    expect(await store.readSeat("korea")).toHaveLength(1);
  });

  it("should record a turn that failed while thinking, without applying anything", async () => {
    const store = new TraceStore(directory, "run-1");
    const world = new RecordedWorld([recordedTurn()]);
    let applied = 0;
    world.applyDecision = () => {
      applied += 1;
      return [];
    };
    const runtime = new SeatRuntime({
      client: {
        async sendObservation(): Promise<SeatTurnResult> {
          throw new Error("the provider went away");
        }
      },
      world,
      socialDirectory,
      store
    });

    const pending = await runtime.decideTurn("korea", 4);
    const record = await runtime.commitTurn(pending);

    // A seat that never reached a decision is still a fact about the run, so the
    // turn is recorded, and no action was invented for it.
    expect(applied).toBe(0);
    expect(record.outcome).toBe("failed");
    expect(record.error).toBe("the provider went away");
    expect(record.observation).toBe("TURN 4 (simulated game sim)");
  });

  it("should read the same as playing the turn in one step", async () => {
    // The composed call must be exactly the two phases, so a game that needs no
    // special handling is unaffected by their existence.
    const splitStore = new TraceStore(path.join(directory, "split"), "run-1");
    const wholeStore = new TraceStore(path.join(directory, "whole"), "run-1");
    const splitWorld = new RecordedWorld([recordedTurn()]);
    const wholeWorld = new RecordedWorld([recordedTurn()]);
    splitWorld.applyDecision = () => [{ type: "research", taken: true }];
    wholeWorld.applyDecision = () => [{ type: "research", taken: true }];

    const splitRuntime = new SeatRuntime({ client: committingDriver(), world: splitWorld, socialDirectory, store: splitStore });
    const split = await splitRuntime.commitTurn(await splitRuntime.decideTurn("korea", 4));
    const wholeRuntime = new SeatRuntime({ client: committingDriver(), world: wholeWorld, socialDirectory, store: wholeStore });
    const whole = await wholeRuntime.playTurn("korea", 4);

    // Everything except the two timestamps, which are the moments the runs
    // happened rather than anything about the turn.
    const withoutTimes = ({ startedAt, completedAt, ...rest }: typeof split) => rest;
    expect(withoutTimes(split)).toEqual(withoutTimes(whole));
  });
});

