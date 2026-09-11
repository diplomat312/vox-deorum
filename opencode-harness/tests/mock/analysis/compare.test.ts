// Covers the run comparison: that it flattens the same measures for every run,
// that it writes them in a stable order, and that it says what changed against
// the baseline.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compareRuns, measuresOf, renderComparison } from "../../../src/analysis/compare.js";
import type { RunReport } from "../../../src/analysis/report.js";

// A report with nothing interesting in it, so each test varies one measure.
function report(overrides: Partial<RunReport> = {}): RunReport {
  return {
    runId: "run-1",
    game: "sim",
    seats: ["korea"],
    turnsPlayed: 10,
    fromTurn: 1,
    toTurn: 10,
    diplomacy: {
      operations: 0,
      byKind: {},
      seatsThatSpoke: [],
      seatsSilent: ["korea"],
      authored: { korea: 0 },
      addressed: { korea: 0 },
      directPairs: {},
      answeredPairs: [],
      refusals: 0,
      turnsWithSocial: 0,
      longestSilence: 10,
      directReplyRate: 0
    },
    cost: {
      perSeat: {},
      totalCost: 0.1,
      cacheHitRatio: 0.9,
      inputPerTurn: 1000,
      costPerTurn: 0.01,
      costPerSocialOperation: null,
      slowestTurnMs: 5000,
      unfinished: 0,
      contextResets: 0
    },
    gaps: {},
    roundup: [],
    ...overrides
  };
}

// Write one run directory that a comparison can read.
async function writeRun(directory: string, runId: string, social: unknown[]): Promise<string> {
  const runDirectory = path.join(directory, runId);
  await mkdir(path.join(runDirectory, "trace"), { recursive: true });
  await mkdir(path.join(runDirectory, "social"), { recursive: true });
  await writeFile(
    path.join(runDirectory, "trace", "korea.jsonl"),
    JSON.stringify({
      runId,
      game: "sim",
      seat: "korea",
      turn: 1,
      startedAt: "t",
      completedAt: "t",
      observation: "TURN 1",
      reasoning: "thinking",
      modelText: null,
      toolCalls: [],
      usage: { input: 100, output: 10, reasoning: 5, cacheRead: 900, cacheWrite: 0, total: 1015, cost: 0.02 },
      unknownParts: [],
      outcome: "passed",
      applied: "nothing applied",
      error: null,
      latencyMs: 4000
    }) + "\n",
    "utf8"
  );
  await writeFile(
    path.join(runDirectory, "social", "social.jsonl"),
    social.map((entry) => JSON.stringify(entry)).join("\n") + (social.length > 0 ? "\n" : ""),
    "utf8"
  );
  return runDirectory;
}

describe("the run comparison", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "harness-compare-"));
  });

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("should flatten the measures a table needs", () => {
    const measures = measuresOf(
      report({
        diplomacy: {
          ...report().diplomacy,
          operations: 7,
          byKind: { world: 4, dm: 2, "group-msg": 1 },
          seatsSilent: [],
          longestSilence: 3,
          directReplyRate: 0.5
        }
      })
    );

    expect(measures.operations).toBe(7);
    expect(measures.world).toBe(4);
    expect(measures.direct).toBe(2);
    expect(measures.group).toBe(1);
    expect(measures.silence).toBe(0);
    expect(measures.directReplyRate).toBe(0.5);
    expect(measures.cacheHitRatio).toBe(0.9);
  });

  it("should list what changed against the baseline", () => {
    const baseline = report();
    const variant = report({
      runId: "run-2",
      diplomacy: { ...report().diplomacy, operations: 3, seatsSilent: [] }
    });

    const markdown = renderComparison({
      baseline: "run-1",
      runs: [measuresOf(baseline), measuresOf(variant)]
    });

    expect(markdown).toContain("| Measure | run-1 | run-2 |");
    expect(markdown).toContain("Baseline is run-1");
    expect(markdown).toContain("run-2: Social operations up from zero");
    expect(markdown).toContain("Silent seats down");
  });

  it("should read several run directories and keep the order given", async () => {
    const first = await writeRun(directory, "a-run", [
      { id: "e-1", at: "t", from: "korea", kind: "world", to: "world", text: "hello" }
    ]);
    const second = await writeRun(directory, "b-run", []);

    const comparison = await compareRuns([first, second]);

    expect(comparison.baseline).toBe("a-run");
    expect(comparison.runs.map((entry) => entry.runId)).toEqual(["a-run", "b-run"]);
    expect(comparison.runs[0].operations).toBe(1);
    expect(comparison.runs[1].operations).toBe(0);
    expect(comparison.runs[1].silence).toBe(1);
  });
});
