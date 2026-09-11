// Covers the run report: that it counts what the seats said, that it works out
// what the run cost, and that it reads a real run directory off disk.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readRun } from "../../../src/analysis/read-run.js";
import { buildReport, costMetrics, diplomacyMetrics, renderReport, toolCallCounts, writeReport } from "../../../src/analysis/report.js";
import { TraceStore } from "../../../src/trace/store.js";
import type { TraceRecord } from "../../../src/trace/types.js";

// A recorded turn, so each test varies only what it checks.
function record(overrides: Partial<TraceRecord> = {}): TraceRecord {
  return {
    runId: "run-1",
    game: "sim",
    seat: "korea",
    turn: 1,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:05.000Z",
    observation: "TURN 1",
    reasoning: "Korea should settle east first. Then look at Austria.",
    modelText: null,
    toolCalls: [],
    usage: { input: 100, output: 20, reasoning: 40, cacheRead: 900, cacheWrite: 10, total: 1060, cost: 0.01 },
    unknownParts: [],
    outcome: "committed",
    applied: "committed research",
    error: null,
    latencyMs: 5000,
    ...overrides
  };
}

describe("the run report", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "harness-report-"));
  });

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("should count what each seat said and who was silent", () => {
    const data = {
      runId: "run-1",
      game: "sim",
      trace: new Map([["korea", [record()]], ["austria", [record({ seat: "austria" })]]]),
      social: [
        // A direct message carries both seats in its scope, sorted, which is
        // how the store writes it.
        { id: "e-1", at: "t", from: "korea", kind: "dm" as const, to: "dm:austria:korea", text: "hello" },
        { id: "e-2", at: "t", from: "austria", kind: "dm" as const, to: "dm:austria:korea", text: "hi back" },
        { id: "e-3", at: "t", from: "korea", kind: "world" as const, to: "world", text: "to everyone" }
      ],
      toolCalls: []
    };

    const metrics = diplomacyMetrics(data, ["korea", "austria", "siam"]);

    expect(metrics.operations).toBe(3);
    expect(metrics.byKind).toEqual({ dm: 2, world: 1 });
    expect(metrics.seatsThatSpoke).toEqual(["korea", "austria"]);
    expect(metrics.seatsSilent).toEqual(["siam"]);
    expect(metrics.authored).toEqual({ korea: 2, austria: 1, siam: 0 });
    expect(metrics.addressed).toEqual({ korea: 1, austria: 1, siam: 0 });
    expect(metrics.directPairs).toEqual({ "austria|korea": 2 });
    expect(metrics.answeredPairs).toEqual(["austria|korea"]);
    expect(metrics.directReplyRate).toBe(1);
    expect(metrics.activePairs).toBe(1);
  });

  it("should measure how long a private channel stayed in use", () => {
    // A channel used twice, ten minutes apart, against one used twice in the
    // same minute. The second is a courtesy, the first is closer to a
    // relationship, and the span is what tells them apart.
    const data = {
      runId: "run-1",
      game: "sim",
      trace: new Map([["korea", [record()]], ["austria", [record({ seat: "austria" })]]]),
      social: [
        { id: "e-1", at: "2026-01-01T00:00:00.000Z", from: "korea", kind: "dm" as const, to: "dm:austria:korea", text: "hello" },
        { id: "e-2", at: "2026-01-01T00:10:00.000Z", from: "austria", kind: "dm" as const, to: "dm:austria:korea", text: "hi back" },
        { id: "e-3", at: "2026-01-01T01:00:00.000Z", from: "siam", kind: "dm" as const, to: "dm:korea:siam", text: "greetings" }
      ],
      toolCalls: []
    };

    const metrics = diplomacyMetrics(data, ["korea", "austria", "siam"]);

    expect(metrics.activePairs).toBe(2);
    expect(metrics.pairMinutes["austria|korea"]).toBe(10);
    expect(metrics.pairMinutes["korea|siam"]).toBe(0);
    expect(metrics.medianPairMinutes).toBe(5);
  });

  it("should report a table that talked to nobody", () => {
    const data = {
      runId: "run-1",
      game: "sim",
      trace: new Map([["korea", [record()]]]),
      social: [],
      toolCalls: []
    };

    const metrics = diplomacyMetrics(data, ["korea"]);

    expect(metrics.operations).toBe(0);
    expect(metrics.seatsSilent).toEqual(["korea"]);
    expect(metrics.directReplyRate).toBe(0);
    expect(metrics.longestSilence).toBe(1);
  });

  it("should measure the longest stretch of quiet turns", () => {
    const silent = [1, 2, 3, 4].map((turn) => record({ turn }));
    const data = {
      runId: "run-1",
      game: "sim",
      trace: new Map([
        [
          "korea",
          silent.map((entry, index) =>
            index === 1
              ? {
                  ...entry,
                  toolCalls: [
                    { tool: "vox-civ_communicate", callID: null, status: "completed", input: {}, output: "{}", error: null }
                  ]
                }
              : entry
          )
        ]
      ]),
      social: [],
      toolCalls: []
    };

    expect(diplomacyMetrics(data, ["korea"]).longestSilence).toBe(2);
  });

  it("should work out the cache share and the cost of talking", () => {
    const data = {
      runId: "run-1",
      game: "sim",
      trace: new Map([
        ["korea", [record({ turn: 1 }), record({ turn: 2 })]],
        ["austria", [record({ seat: "austria", turn: 1 })]]
      ]),
      social: [
        { id: "e-1", at: "t", from: "korea", kind: "world" as const, to: "world", text: "hello" },
        { id: "e-2", at: "t", from: "austria", kind: "dm" as const, to: "dm:austria:korea", text: "hi" }
      ],
      toolCalls: []
    };

    const cost = costMetrics(data, ["korea", "austria"]);

    expect(cost.perSeat.korea.turns).toBe(2);
    expect(cost.perSeat.korea.cacheRead).toBe(1800);
    expect(cost.totalCost).toBeCloseTo(0.03, 6);
    expect(cost.cacheHitRatio).toBeCloseTo(2700 / 3030, 4);
    expect(cost.inputPerTurn).toBe(100);
    expect(cost.costPerSocialOperation).toBeCloseTo(0.015, 6);
    expect(cost.slowestTurnMs).toBe(5000);
  });

  it("should count the tools the seats called", () => {
    const counts = toolCallCounts([
      { at: "t", seat: "korea", turn: 1, tool: "vox-civ_inspect", arguments: {}, result: "{}" },
      { at: "t", seat: "korea", turn: 1, tool: "vox-civ_inspect", arguments: {}, result: "{}" },
      { at: "t", seat: "korea", turn: 1, tool: "vox-civ_pass", arguments: {}, result: "ok" }
    ]);

    expect(counts).toEqual({ inspect: 2, pass: 1 });
  });

  it("should read a run directory and write its report there", async () => {
    const runDirectory = path.join(directory, "run-1");
    const store = new TraceStore(path.join(runDirectory, "trace"), "run-1");
    await store.record(record({ turn: 1 }));
    await store.record(record({ turn: 2, outcome: "passed", applied: "nothing applied" }));
    await mkdir(path.join(runDirectory, "social"), { recursive: true });
    await writeFile(
      path.join(runDirectory, "social", "social.jsonl"),
      JSON.stringify({ id: "e-1", at: "t", from: "korea", kind: "world", to: "world", text: "hello" }) + "\n",
      "utf8"
    );
    await writeFile(
      path.join(runDirectory, "social", "tool-calls.jsonl"),
      JSON.stringify({ at: "t", seat: "korea", turn: 1, tool: "vox-civ_inspect", arguments: {}, result: "{}" }) + "\n",
      "utf8"
    );

    const data = await readRun(runDirectory);
    const report = await writeReport(runDirectory);
    const markdown = renderReport(report, data.toolCalls);

    expect(data.game).toBe("sim");
    expect(report.turnsPlayed).toBe(2);
    expect(report.diplomacy.operations).toBe(1);
    expect(report.roundup[0].thought).toContain("Korea should settle east first.");
    expect(report.roundup[1].did).toBe("passed");
    expect(markdown).toContain("## Diplomacy");
    expect(markdown).toContain("## What it cost");
    expect(markdown).toContain("## Roundup");
    expect(markdown).toContain("Tools called: inspect 1.");
    expect(await buildReport(runDirectory)).toMatchObject({ runId: "run-1" });
  });
});
