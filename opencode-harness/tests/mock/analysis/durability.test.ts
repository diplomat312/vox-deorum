// Covers the durability reading: whether contact between two seats was a single
// exchange or a channel that stayed open.

import { describe, expect, it } from "vitest";
import { durabilityMetrics } from "../../../src/analysis/durability.js";
import type { TraceRecord } from "../../../src/trace/types.js";
import type { SocialEntry } from "../../../src/social/social-store.js";

// A recorded turn for one seat, with a window a message can fall inside.
function record(seat: string, turn: number, startedAt: string, completedAt: string): TraceRecord {
  return {
    runId: "run-1",
    game: "sim",
    seat,
    turn,
    startedAt,
    completedAt,
    observation: "TURN " + turn,
    reasoning: "",
    modelText: null,
    toolCalls: [],
    usage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: null },
    unknownParts: [],
    outcome: "passed",
    applied: "nothing applied",
    error: null,
    latencyMs: 1
  };
}

// A direct message between two seats, at a moment.
function message(from: string, to: string, at: string): SocialEntry {
  return { id: "e-" + at, at, from, kind: "dm", to: "dm:" + [from, to].sort().join(":") };
}

// A pair of seats exchanging messages on the given turns.
function contact(turns: number[], from = "korea", to = "austria"): { records: TraceRecord[]; social: SocialEntry[] } {
  const records: TraceRecord[] = [];
  const social: SocialEntry[] = [];
  for (const turn of turns) {
  // Each seat turn gets a one-hour window, so a message written during it
  // lands on the right turn.
    // Two hours per turn from a fixed base, so a run of many turns still lands
    // on real timestamps rather than an impossible hour of the day.
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    const startedAt = new Date(base + turn * 2 * 3600000).toISOString();
    const completedAt = new Date(base + (turn * 2 + 1) * 3600000).toISOString();
    records.push(record(from, turn, startedAt, completedAt));
    records.push(record(to, turn, startedAt, completedAt));
    social.push(message(from, to, new Date(base + (turn * 2) * 3600000 + 1800000).toISOString()));
  }
  return { records, social };
}

describe("whether a relationship lasted", () => {
  it("should tell a single exchange from a channel kept open", () => {
    const burst = durabilityMetrics(contact([4, 5, 6]).records, contact([4, 5, 6]).social);
    const kept = durabilityMetrics(contact([4, 20, 40]).records, contact([4, 20, 40]).social);

    // Both spoke three times. One did it in three turns running and the other
    // across the whole game, and only the span tells them apart.
    expect(burst.pairs[0].messages).toBe(3);
    expect(kept.pairs[0].messages).toBe(3);
    expect(burst.pairs[0].span).toBe(2);
    expect(kept.pairs[0].span).toBe(36);
  });

  it("should measure how long a channel went quiet", () => {
    const metrics = durabilityMetrics(contact([2, 3, 20]).records, contact([2, 3, 20]).social);

    expect(metrics.pairs[0].longestQuietGap).toBe(16);
  });

  it("should count a pair that spoke once as an exchange rather than a relationship", () => {
    const metrics = durabilityMetrics(contact([7]).records, contact([7]).social);

    expect(metrics.pairs).toHaveLength(1);
    expect(metrics.pairs[0].turnsInContact).toBe(1);
    expect(metrics.sustainedPairs).toBe(0);
  });

  it("should report a channel that ran to the end of the game", () => {
    // Contact on turns 1, 8 and 14 of a fifteen turn game.
    const metrics = durabilityMetrics(contact([1, 8, 14]).records, contact([1, 8, 14]).social);

    expect(metrics.lastTurn).toBe(14);
    expect(metrics.pairsStillActiveAtEnd).toBe(1);
  });

  it("should report a channel that faded early", () => {
    const contact1 = contact([1, 2, 3]);
    // A separate seat pair that speaks late gives the run its length.
    const late = contact([14], "siam", "iroquois");
    const metrics = durabilityMetrics(
      [...contact1.records, ...late.records],
      [...contact1.social, ...late.social]
    );

    // Austria and Korea last spoke on turn 3 of a game that ran to 14, so their
    // channel did not last to the end.
    const faded = metrics.pairs.find((pair) => pair.pair === "austria|korea");
    expect(faded?.lastTurn).toBe(3);
    expect(metrics.pairsStillActiveAtEnd).toBe(1);
  });

  it("should count how much of its open window a channel was in use", () => {
    const metrics = durabilityMetrics(contact([4, 5, 6]).records, contact([4, 5, 6]).social);

    // Three turns of contact over a three turn window.
    expect(metrics.pairs[0].turnCoverage).toBe(1);
  });

  it("should report nothing rather than failing on a silent table", () => {
    const metrics = durabilityMetrics([record("korea", 1, "2026-01-01T00:00:00.000Z", "2026-01-01T01:00:00.000Z")], []);

    expect(metrics.pairs).toEqual([]);
    expect(metrics.sustainedPairs).toBe(0);
    expect(metrics.medianSpan).toBe(0);
  });
});
