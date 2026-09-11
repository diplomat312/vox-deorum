// Covers the run record: what one turn writes, how a seat's turns read back,
// and the run summary the benchmark metrics are built from.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TraceStore } from "../../../src/trace/store.js";
import type { TraceRecord } from "../../../src/trace/types.js";

// One complete turn, so a test varies only the field it checks.
function record(overrides: Partial<TraceRecord> = {}): TraceRecord {
  return {
    runId: "run-1",
    game: "fresh4",
    seat: "korea",
    turn: 1,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:05.000Z",
    observation: "TURN 1 (live game fresh4)",
    reasoning: "Korea should settle east first.",
    modelText: "Committing research.",
    toolCalls: [
      { tool: "vox-civ_inspect", callID: "call_1", status: "completed", input: { subject: "self" }, output: "{}", error: null }
    ],
    usage: { input: 100, output: 20, reasoning: 40, cacheRead: 900, cacheWrite: 10, total: 1060, cost: 0.01 },
    unknownParts: [],
    outcome: "committed",
    applied: "set-research accepted",
    error: null,
    latencyMs: 5000,
    ...overrides
  };
}

describe("the run record", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "harness-trace-"));
  });

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("should return an empty list for a seat that never took a turn", async () => {
    const store = new TraceStore(directory, "run-1");

    expect(await store.readSeat("nowhere")).toEqual([]);
  });

  it("should keep everything that was written to a turn", async () => {
    const store = new TraceStore(directory, "run-1");
    await store.record(record());

    const turns = await store.readSeat("korea");

    expect(turns).toHaveLength(1);
    expect(turns[0].reasoning).toBe("Korea should settle east first.");
    expect(turns[0].toolCalls[0].tool).toBe("vox-civ_inspect");
    expect(turns[0].usage.cacheRead).toBe(900);
    expect(turns[0].outcome).toBe("committed");
  });

  it("should append rather than replace, keeping the order turns happened in", async () => {
    const store = new TraceStore(directory, "run-1");
    await store.record(record({ turn: 2 }));
    await store.record(record({ turn: 3 }));

    expect((await store.readSeat("korea")).map((turn) => turn.turn)).toEqual([2, 3]);
  });

  it("should refuse a record that belongs to a different run", async () => {
    const store = new TraceStore(directory, "run-1");

    await expect(store.record(record({ runId: "run-2" }))).rejects.toThrowError(/cannot be written to the store/);
  });

  it("should read every seat in a stable order", async () => {
    const store = new TraceStore(directory, "run-1");
    await store.record(record({ seat: "siam" }));
    await store.record(record({ seat: "austria" }));

    expect([...(await store.readAll()).keys()]).toEqual(["austria", "siam"]);
  });

  it("should summarise a run across seats", async () => {
    const store = new TraceStore(directory, "run-1");
    await store.record(record({ seat: "korea", turn: 4 }));
    await store.record(record({ seat: "siam", turn: 9, outcome: "passed", usage: { input: 50, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 55, cost: null } }));

    const summary = await store.summary();

    expect(summary.runId).toBe("run-1");
    expect(summary.game).toBe("fresh4");
    expect(summary.seats).toEqual(["korea", "siam"]);
    expect(summary.turnCount).toBe(2);
    expect(summary.firstTurn).toBe(4);
    expect(summary.lastTurn).toBe(9);
    expect(summary.totals.input).toBe(150);
    expect(summary.totals.cacheRead).toBe(900);
    expect(summary.totals.cost).toBeCloseTo(0.01, 6);
    expect(summary.outcomes).toEqual({ committed: 1, passed: 1, unfinished: 0, failed: 0 });
  });

  it("should summarise an empty run without inventing a turn span", async () => {
    const store = new TraceStore(path.join(directory, "nothing-here"), "run-1");

    const summary = await store.summary();

    expect(summary.turnCount).toBe(0);
    expect(summary.firstTurn).toBeNull();
    expect(summary.lastTurn).toBeNull();
    expect(summary.seats).toEqual([]);
  });

  it("should name the line when a trace file is damaged", async () => {
    const store = new TraceStore(directory, "run-1");
    await store.record(record());
    await rm(path.join(directory, "korea.jsonl"));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(directory, "korea.jsonl"), JSON.stringify(record()) + "\nnot json\n", "utf8");

    await expect(store.readSeat("korea")).rejects.toThrowError(/damaged line at line 2/);
  });
});
