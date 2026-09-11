// Covers the variant summary: that it averages a measure across runs, that it
// reports the range, and that it refuses to call an overlapping difference a
// result.

import { describe, expect, it } from "vitest";
import { renderAggregate, summariseVariant } from "../../../src/analysis/aggregate.js";
import type { RunMeasures } from "../../../src/analysis/compare.js";

// One run's measures, so a test varies only what it checks.
function measures(overrides: Partial<RunMeasures> = {}): RunMeasures {
  return {
    runId: "run-1",
    seats: ["korea"],
    turnsPlayed: 40,
    operations: 4,
    world: 4,
    direct: 0,
    group: 0,
    councils: 0,
    invites: 0,
    accepts: 0,
    silence: 0,
    turnsWithSocial: 2,
    longestSilence: 8,
    directReplyRate: 0,
    activePairs: 0,
    medianPairMinutes: 0,
    substantiveRate: 0,
    personalisedRate: 0,
    metaRate: 0,
    proposals: 0,
    repairs: 0,
    postures: 0,
    seatsWithoutPosture: 0,
    actionRate: 0,
    sustainedPairs: 0,
    pairsStillActiveAtEnd: 0,
    medianSpan: 0,
    medianCoverage: 0,
    refusals: 0,
    cacheHitRatio: 0.95,
    inputPerTurn: 4000,
    totalCost: 0.04,
    costPerTurn: 0.001,
    costPerSocialOperation: 0.01,
    unfinished: 0,
    contextResets: 0,
    slowestTurnMs: 30000,
    ...overrides
  };
}

describe("summarising a variant", () => {
  it("should average a measure and report the range", () => {
    const summary = summariseVariant("trial", [
      measures({ runId: "trial-s11", operations: 4 }),
      measures({ runId: "trial-s12", operations: 10 }),
      measures({ runId: "trial-s13", operations: 7 })
    ]);

    const operations = summary.measures.find((entry) => entry.label === "Social operations");

    expect(operations?.mean).toBeCloseTo(7, 6);
    expect(operations?.min).toBe(4);
    expect(operations?.max).toBe(10);
    expect(operations?.samples).toBe(3);
    expect(summary.runIds).toEqual(["trial-s11", "trial-s12", "trial-s13"]);
  });

  it("should leave out a measure no run could report", () => {
    const summary = summariseVariant("trial", [
      measures({ costPerSocialOperation: null }),
      measures({ costPerSocialOperation: null })
    ]);

    const cost = summary.measures.find((entry) => entry.label === "Cost per social operation");

    expect(cost?.mean).toBeNull();
    expect(cost?.samples).toBe(0);
  });

  it("should call a wide difference a result and an overlapping one a non-result", () => {
    // The baseline runs range 3 to 5 operations, so a variant at 20 is clearly
    // outside it while a variant at 4 is inside it.
    const baseline = summariseVariant("base", [
      measures({ runId: "base-s11", operations: 3 }),
      measures({ runId: "base-s12", operations: 5 })
    ]);
    const clear = summariseVariant("clear", [
      measures({ runId: "clear-s11", operations: 20 }),
      measures({ runId: "clear-s12", operations: 24 })
    ]);
    const overlapping = summariseVariant("shrug", [
      measures({ runId: "shrug-s11", operations: 5 }),
      measures({ runId: "shrug-s12", operations: 6 })
    ]);

    const markdown = renderAggregate([baseline, clear, overlapping]);

    expect(markdown).toContain("| Social operations | 4 (3 to 5) | 22 (20 to 24) | 5.5 (5 to 6) |");
    expect(markdown).toContain("clear: Social operations higher (ranges do not overlap)");
    expect(markdown).toContain("shrug: Social operations higher (ranges overlap, not a result)");
  });

  it("should count how many runs produced a sparse measure at all", () => {
    // Postures are the shape a sparse measure has: mostly nothing, with the
    // occasional run where a seat decides to record its regard.
    const summary = summariseVariant("trial", [
      measures({ runId: "t-1", postures: 0 }),
      measures({ runId: "t-2", postures: 5 }),
      measures({ runId: "t-3", postures: 3 })
    ]);

    const postures = summary.measures.find((entry) => entry.label === "Posture changes");

    expect(postures?.runsWithAny).toBe(2);
    expect(postures?.samples).toBe(3);
  });

  it("should call a sparse measure a difference by how often it happened, not by its range", () => {
    // Something that never happens against something that happens in most runs
    // is a real difference, even though one run of the second produced none and
    // the ranges therefore touch at zero.
    const never = summariseVariant("never", [
      measures({ runId: "n-1", postures: 0 }),
      measures({ runId: "n-2", postures: 0 }),
      measures({ runId: "n-3", postures: 0 })
    ]);
    const sometimes = summariseVariant("sometimes", [
      measures({ runId: "s-1", postures: 0 }),
      measures({ runId: "s-2", postures: 5 }),
      measures({ runId: "s-3", postures: 3 })
    ]);
    const once = summariseVariant("once", [
      measures({ runId: "o-1", postures: 0 }),
      measures({ runId: "o-2", postures: 0 }),
      measures({ runId: "o-3", postures: 4 })
    ]);

    const markdown = renderAggregate([never, sometimes, once]);

    expect(markdown).toContain("sometimes: Posture changes higher (in 2 of 3 runs against never)");
    expect(markdown).toContain("once: Posture changes higher (in 1 of 3 runs against 0 of 3, not a result)");
  });

  it("should describe a single variant without pretending to compare it", () => {
    const markdown = renderAggregate([summariseVariant("solo", [measures(), measures({ runId: "solo-s12" })])]);

    expect(markdown).toContain("One variant, played 2 time(s).");
    expect(markdown).not.toContain("What stands out");
  });
});
