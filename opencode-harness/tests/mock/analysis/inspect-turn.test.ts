// Covers the full view of one seat turn, which is the thing to read when asking
// whether the observation is carrying the right information.

import { describe, expect, it } from "vitest";
import { pickTurn, renderTurn } from "../../../src/analysis/inspect-turn.js";
import type { TraceRecord } from "../../../src/trace/types.js";

// One recorded turn, with whatever a test gives it.
function turn(overrides: Partial<TraceRecord> = {}): TraceRecord {
  return {
    runId: "run-1",
    game: "run-1",
    seat: "korea",
    turn: 5,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    observation: "TURN 5 and a treasury line",
    reasoning: "Austria is quiet. I will hold.",
    modelText: "Holding steady.",
    toolCalls: [],
    usage: { input: 10, output: 20, reasoning: 30, cacheRead: 40, cacheWrite: 0, total: 100, cost: 0.001 },
    unknownParts: [],
    outcome: "committed",
    applied: "committed research",
    refused: [],
    error: null,
    latencyMs: 1234,
    ...overrides
  };
}

describe("reading one turn in full", () => {
  it("should show the observation exactly as it was sent", () => {
    const markdown = renderTurn(turn());

    // The observation is the point of the view, so it is reproduced and never
    // summarised: a reader asking what a model saw should read that.
    expect(markdown).toContain("## What the seat was shown");
    expect(markdown).toContain("TURN 5 and a treasury line");
  });

  it("should show what the seat called and what came back", () => {
    const markdown = renderTurn(
      turn({
        toolCalls: [
          {
            tool: "vox-civ_inspect",
            callID: "call-1",
            status: "completed",
            input: { subject: "self" },
            output: "a gold figure",
            error: null
          },
          {
            tool: "vox-civ_commit_turn",
            callID: "call-2",
            status: "completed",
            input: { actions: [] },
            output: "Committed at turn 5",
            error: null
          }
        ]
      })
    );

    expect(markdown).toContain("### vox-civ_inspect (completed)");
    expect(markdown).toContain("subject");
    expect(markdown).toContain("Committed at turn 5");
  });

  it("should show a call the tool refused", () => {
    const markdown = renderTurn(
      turn({
        toolCalls: [
          {
            tool: "vox-civ_communicate",
            callID: null,
            status: "completed",
            input: { operations: [] },
            output: null,
            error: "needs at least one operation"
          }
        ]
      })
    );

    expect(markdown).toContain("refused: needs at least one operation");
  });

  it("should say what the world would not do", () => {
    const markdown = renderTurn(
      turn({
        refused: [{ type: "policy", reason: "no policy is ready" }]
      })
    );

    expect(markdown).toContain("## What the world would not do");
    expect(markdown).toContain("policy: no policy is ready");
  });

  it("should say plainly when a turn recorded no thinking or no calls", () => {
    const markdown = renderTurn(turn({ reasoning: null, modelText: null, latencyMs: 25000 }));

    expect(markdown).toContain("_No thinking was recorded._");
    expect(markdown).toContain("_No tool was called._");
  });

  it("should note a turn that had to be asked again", () => {
    const markdown = renderTurn(turn({ emptyRetries: 1 }));

    expect(markdown).toContain("asked again 1 time(s) after an empty answer");
  });

  it("should pick the last turn a seat took when no turn is named", () => {
    const records = [
      turn({ seat: "korea", turn: 3 }),
      turn({ seat: "korea", turn: 7 }),
      turn({ seat: "austria", turn: 9 })
    ];

    expect(pickTurn(records, { seat: "korea" })?.turn).toBe(7);
    expect(pickTurn(records, { seat: "austria" })?.seat).toBe("austria");
    expect(pickTurn(records, {})?.turn).toBe(9);
    expect(pickTurn(records, { seat: "siam" })).toBeNull();
  });
});

