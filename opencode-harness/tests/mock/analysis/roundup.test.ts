// Covers the roundup: that it finds the moments worth keeping, that it does not
// repeat itself, and that it keeps the sentence a reading came from.

import { describe, expect, it } from "vitest";
import { buildRoundup, renderRoundup } from "../../../src/analysis/roundup.js";
import type { TraceRecord } from "../../../src/trace/types.js";

// One recorded turn, so a test varies only the thinking.
function record(overrides: Partial<TraceRecord> = {}): TraceRecord {
  return {
    runId: "run-1",
    game: "sim",
    seat: "austria",
    turn: 1,
    startedAt: "t",
    completedAt: "t",
    observation: "TURN 1",
    reasoning: "",
    modelText: null,
    toolCalls: [],
    usage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: null },
    unknownParts: [],
    outcome: "passed",
    applied: "nothing applied",
    error: null,
    latencyMs: 1,
    ...overrides
  };
}

const seats = ["korea", "austria", "siam", "iroquois"];

// The parties at the table, as a reading sees them: every name a seat answers
// to, and the name to show a reader.
const parties = [
  { seat: "korea", display: "Korea", names: ["korea", "Korea", "Sejong"] },
  { seat: "austria", display: "Austria", names: ["austria", "Austria", "Maria Theresa"] },
  { seat: "siam", display: "Siam", names: ["siam", "Siam", "Ramkhamhaeng"] },
  { seat: "iroquois", display: "Iroquois", names: ["iroquois", "Iroquois", "Hiawatha"] }
];

describe("reconstructing what a seat was thinking", () => {
  it("should find an intention", () => {
    const moments = buildRoundup(
      [record({ reasoning: "Pottery is the standard opening. I plan to settle east first and build a Library." })],
      parties
    );

    expect(moments).toHaveLength(1);
    expect(moments[0].kind).toBe("intention");
    expect(moments[0].quote).toContain("settle east first");
  });

  it("should find a reaction and say who it was about", () => {
    const moments = buildRoundup(
      [
        record({
          seat: "korea",
          reasoning: "This is a crisis. Austria broke their word to Korea and the terms were never honoured.",
          turn: 12
        })
      ],
      parties
    );

    expect(moments[0].kind).toBe("reaction");
    // The sentence names Austria, so the moment says who it concerns.
    expect(moments[0].about).toBe("Austria");
    expect(moments[0].turn).toBe(12);
  });

  it("should find a suspicion about another seat by leader name", () => {
    const moments = buildRoundup(
      [record({ seat: "siam", reasoning: "Hiawatha is massing troops and I do not trust the timing of it." })],
      parties
    );

    expect(moments[0].kind).toBe("suspicion");
    // The sentence named the leader, and the moment reports the civilization,
    // because that is the name a reader of the roundup knows.
    expect(moments[0].about).toBe("Iroquois");
  });

  it("should not repeat the same thought across many quiet turns", () => {
    const same = "Steady. Nothing to change this turn, and I will hold my course.";
    const moments = buildRoundup(
      [1, 2, 3, 4, 5].map((turn) => record({ turn, reasoning: same })),
      parties
    );

    expect(moments).toHaveLength(1);
  });

  it("should take a few moments from a turn rather than everything in it", () => {
    const long = [
      "I intend to settle east first this turn.",
      "I suspect Austria is watching my borders closely.",
      "I will offer Siam a trade in the next turn or two.",
      "I plan to build a Library after the Granary is done.",
      "I worry that the Iroquois levy is not defensive at all."
    ].join(" ");

    const moments = buildRoundup([record({ reasoning: long })], parties);

    expect(moments.length).toBeLessThanOrEqual(2);
  });

  it("should skip a turn with no reasoning", () => {
    expect(buildRoundup([record({ reasoning: null })], parties)).toEqual([]);
  });

  it("should render the moments by seat, in turn order, with the sentence kept", () => {
    const moments = buildRoundup(
      [
        record({ seat: "korea", turn: 3, reasoning: "I intend to expand toward the river." }),
        record({ seat: "austria", turn: 1, reasoning: "I plan to open with Tradition for a tall empire." })
      ],
      parties
    );

    const markdown = renderRoundup(moments, "run-1", ["austria", "korea"], {
      austria: "Austria (Maria Theresa)",
      korea: "Korea (Sejong)"
    });

    expect(markdown).toContain("# Roundup: run-1");
    expect(markdown).toContain("## Austria (Maria Theresa)");
    expect(markdown).toContain("## Korea (Sejong)");
    expect(markdown).toContain("**turn 3**");
    expect(markdown).toContain("expand toward the river");
    // Austria comes first because the caller asked for that order.
    expect(markdown.indexOf("## Austria")).toBeLessThan(markdown.indexOf("## Korea"));
  });

  it("should say plainly when a seat gave nothing to report", () => {
    const markdown = renderRoundup([], "run-1", ["siam"], {});

    expect(markdown).toContain("Nothing worth reporting was recorded for this seat.");
  });
});
