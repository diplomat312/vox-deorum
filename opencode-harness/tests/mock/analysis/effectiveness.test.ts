// Covers the effectiveness reading: whether what the seats said became anything
// in the world, taken from the actions they actually committed.

import { describe, expect, it } from "vitest";
import { effectivenessMetrics } from "../../../src/analysis/effectiveness.js";
import type { TraceRecord } from "../../../src/trace/types.js";

// A recorded turn, optionally carrying the actions a seat committed.
function record(overrides: Partial<TraceRecord> = {}, actions?: unknown[]): TraceRecord {
  return {
    runId: "run-1",
    game: "sim",
    seat: "korea",
    turn: 1,
    startedAt: "t",
    completedAt: "t",
    observation: "TURN 1",
    reasoning: "thinking",
    modelText: null,
    toolCalls:
      actions === undefined
        ? []
        : [
            {
              tool: "vox-civ_commit_turn",
              callID: "c1",
              status: "completed",
              input: { rationale: "because", actions },
              output: "ok",
              error: null
            }
          ],
    usage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: null },
    unknownParts: [],
    outcome: "committed",
    applied: "committed",
    error: null,
    latencyMs: 1,
    ...overrides
  };
}

const seats = ["korea", "austria", "siam", "iroquois"];

describe("what the talking changed", () => {
  it("should read the actions out of a commit", () => {
    const metrics = effectivenessMetrics(
      [record({}, [{ type: "research", technology: "Pottery" }, { type: "posture", target: 1, public: 3 }])],
      seats
    );

    expect(metrics.actions).toHaveLength(2);
    expect(metrics.byType).toEqual({ research: 1, posture: 1 });
    expect(metrics.postures).toBe(1);
    expect(metrics.turnsWithPosture).toBe(1);
  });

  it("should count a posture as changing something lasting", () => {
    const withPosture = effectivenessMetrics([record({}, [{ type: "posture", target: 1 }])], seats);
    const withStandstill = effectivenessMetrics([record({}, [{ type: "keep_status_quo" }])], seats);

    // Keeping the status quo is a decision, but it changes nothing, so it does
    // not count as the talking having had an effect.
    expect(withPosture.actionRate).toBe(1);
    expect(withStandstill.actionRate).toBe(0);
  });

  it("should name the seats that never set a posture", () => {
    const metrics = effectivenessMetrics(
      [
        record({ seat: "korea" }, [{ type: "posture", target: 1 }]),
        record({ seat: "austria" }, [{ type: "research", technology: "Pottery" }])
      ],
      seats
    );

    // Austria committed a research action, which changes something but is not
    // a statement about anyone, so Austria counts as having set no posture.
    expect(metrics.seatsWithoutPosture).toEqual(["austria", "siam", "iroquois"]);
  });

  it("should count a turn with no action at all as changing nothing", () => {
    const metrics = effectivenessMetrics([record({}, undefined), record({ turn: 2 }, [])], seats);

    expect(metrics.actions).toEqual([]);
    expect(metrics.consequential).toBe(0);
    expect(metrics.actionRate).toBe(0);
  });

  it("should survive a malformed action rather than losing the turn", () => {
    const metrics = effectivenessMetrics([record({}, [{ type: "posture" }, "nonsense", null])], seats);

    // The string and the null are skipped, and the usable action is kept.
    expect(metrics.actions).toHaveLength(1);
    expect(metrics.postures).toBe(1);
  });

  it("should report a run where nobody acted", () => {
    const metrics = effectivenessMetrics([], seats);

    expect(metrics.postures).toBe(0);
    expect(metrics.actionRate).toBe(0);
    expect(metrics.seatsWithoutPosture).toEqual(seats);
  });
});
