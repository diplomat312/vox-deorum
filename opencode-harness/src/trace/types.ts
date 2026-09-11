// What the harness keeps about every seat turn.
// This is the interface both products the project exists for are built on:
// the inspector that answers what a seat knew, thought and did, and the
// roundup that reconstructs a seat's intentions across a whole game.

import type { SeatTurnResult } from "../session/types.js";

// How a turn ended, from the harness's point of view rather than the model's.
export type TraceOutcome =
  // The seat committed actions and the world accepted them.
  | "committed"
  // The seat chose to do nothing this turn.
  | "passed"
  // The seat never produced a terminal decision, for example it timed out.
  | "unfinished"
  // The turn failed before a decision was reached.
  | "failed";

// Everything worth keeping about one seat's one turn.
export interface TraceRecord {
  // The run this turn belongs to.
  runId: string;
  // The game or scenario being played.
  game: string;
  // The seat that took the turn.
  seat: string;
  // The turn number in the world.
  turn: number;
  // When the observation was sent, as an ISO timestamp.
  startedAt: string;
  // When the turn finished, as an ISO timestamp.
  completedAt: string;
  // The exact observation handed to the model.
  observation: string;
  // The model's thinking, when the provider emitted it.
  reasoning: string | null;
  // The model's final visible text.
  modelText: string | null;
  // Every tool call the model made, with its arguments and result.
  toolCalls: SeatTurnResult["toolCalls"];
  // Token, cache and spend numbers for the turn.
  usage: SeatTurnResult["usage"];
  // Part types the reader did not recognise, kept so nothing disappears.
  unknownParts: string[];
  // How the turn ended.
  outcome: TraceOutcome;
  // What the world did with the decision, when there was one.
  applied: string | null;
  // The error that ended the turn, when it failed.
  error: string | null;
  // How long the seat spent thinking, in milliseconds.
  latencyMs: number;
}

// A short view of a run, for listing runs without reading every turn.
export interface TraceSummary {
  // The run identifier.
  runId: string;
  // The game or scenario played.
  game: string;
  // Seats that took at least one turn, in a stable order.
  seats: string[];
  // Turns recorded across every seat.
  turnCount: number;
  // The lowest turn number seen, or null when the run holds no turns.
  firstTurn: number | null;
  // The highest turn number seen, or null when the run holds no turns.
  lastTurn: number | null;
  // Totals across the run, which is what the cost side of the frontier reads.
  totals: {
    // Input tokens across the run.
    input: number;
    // Output tokens across the run.
    output: number;
    // Reasoning tokens across the run.
    reasoning: number;
    // Tokens served from the prompt cache across the run.
    cacheRead: number;
    // Tokens written into the prompt cache across the run.
    cacheWrite: number;
    // Spend across the run, when the provider reported any.
    cost: number;
  };
  // How many turns ended each way.
  outcomes: Record<TraceOutcome, number>;
}
