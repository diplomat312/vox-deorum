// Plays one seat's turn, and writes down everything that happened.
// The runtime is the same for a simulated game and, later, a live one: it asks
// the world for the observation, sends it to the seat's session, serves the
// tool calls that come back, and records the result. Only the world changes
// between the two.

import type { SeatTurnResult } from "../session/types.js";
import type { TraceStore } from "../trace/store.js";
import type { TraceOutcome, TraceRecord } from "../trace/types.js";
import type { World } from "../world/types.js";
import { dispatchSeatTool, type CommitAction, type SeatContext } from "./tools.js";

// The part of a session client the runtime needs, so a test can stand in for
// the real one without starting a server.
export interface SessionDriver {
  // Send one observation to a seat and read back what it did. The turn is
  // passed because a driver that hands the turn to a person needs to name it,
  // while a driver talking to a model can ignore it.
  sendObservation(seat: string, observation: string, turn: number): Promise<SeatTurnResult>;
}

// Everything the runtime needs to play a seat.
export interface SeatRuntimeOptions {
  // The session that answers for the seat.
  client: SessionDriver;
  // The state source the seat reads.
  world: World;
  // Where this run keeps its social log.
  socialDirectory: string;
  // Where the run's record is written.
  store: TraceStore;
  // Who actually answers the seat's tool calls.
  //
  // With "serve", the runtime answers them itself, which is what tests use
  // because it needs no processes at all. With "observe", a live tool server
  // has already answered them, and the runtime reads the results out of the
  // session instead of answering them a second time. Answering twice would
  // apply every social message twice, so the distinction matters.
  toolServing?: "serve" | "observe";
  // Called once the world is ready for a turn and before the seat is asked.
  onTurnPrepared?: (seat: string, turn: number) => Promise<void>;
  // Called when a turn fails, to give the harness a chance to put the seat back
  // on its feet. Returning true means the seat now has a fresh session, so the
  // turn is recorded as a context reset rather than only as a failure.
  onTurnFailed?: (seat: string, error: string) => Promise<SeatRepair>;
}

// What a harness did about a failed turn.
//
// "none" leaves the seat alone, which is right when the failure was a passing
// one and the session is healthy. "aborted" cleared the work the seat had
// stalled on, so the seat keeps its history and its cache. "reset" replaced the
// session outright, which loses both and is the last resort.
export type SeatRepair = "none" | "aborted" | "reset";

// Plays turns for the seats of one run.
export class SeatRuntime {
  // The session that answers for each seat.
  private client: SessionDriver;

  // The state source the seats read.
  private readonly world: World;

  // Where the run keeps its social log.
  private readonly socialDirectory: string;

  // Where the run's record is written.
  private readonly store: TraceStore;

  // Who answers the seat's tool calls.
  private readonly toolServing: "serve" | "observe";

  // Called once the world is ready for a turn and before the seat is asked, so
  // a harness can publish the state a tool server in another process will read.
  private readonly onTurnPrepared?: (seat: string, turn: number) => Promise<void>;

  // Called when a turn fails, so the harness can repair the seat.
  private readonly onTurnFailed?: (seat: string, error: string) => Promise<SeatRepair>;

  // Build a runtime for one run.
  constructor(options: SeatRuntimeOptions) {
    this.client = options.client;
    this.world = options.world;
    this.socialDirectory = options.socialDirectory;
    this.store = options.store;
    this.toolServing = options.toolServing ?? "serve";
    this.onTurnPrepared = options.onTurnPrepared;
    this.onTurnFailed = options.onTurnFailed;
  }

  // Replace the session a seat talks through. Only recovery uses this, because
  // a seat is meant to keep one session for a whole game.
  setClient(client: SessionDriver): void {
    this.client = client;
  }

  // Play one turn for one seat and record it. A turn that produces no terminal
  // call is recorded as unfinished rather than being retried silently, because
  // a seat that never decided is a fact about the run.
  async playTurn(seat: string, turn: number): Promise<TraceRecord> {
    const startedAt = new Date().toISOString();
    await this.world.beginTurn(seat, turn);
    if (this.onTurnPrepared) await this.onTurnPrepared(seat, turn);
    const observation = this.world.observation(seat, turn);
    const playerID = this.world.seats().find((entry) => entry.seat === seat)?.playerID ?? null;
    const context: SeatContext = {
      seat,
      playerID,
      turn,
      world: this.world,
      socialDirectory: this.socialDirectory
    };

    let result: SeatTurnResult | null = null;
    let outcome: TraceOutcome = "unfinished";
    let actions: CommitAction[] = [];
    let gaps: Array<{ subject: string; detail?: string }> = [];
    let error: string | null = null;
    let contextReset = false;
    let refused: Array<{ type: string; reason: string }> = [];

    try {
      result = await this.client.sendObservation(seat, observation, turn);
      if (this.toolServing === "serve") {
        const servedCalls = await this.serveCalls(context, result);
        gaps = servedCalls.gaps;
        if (servedCalls.outcome) outcome = servedCalls.outcome;
        actions = servedCalls.actions;
      } else {
        // A live tool server has already applied whatever the seat asked for,
        // so the runtime only classifies it here.
        const observed = readServedCalls(result);
        gaps = observed.gaps;
        if (observed.outcome) outcome = observed.outcome;
        actions = observed.actions;
      }
      // A committed decision lands in the world here, whichever mode served the
      // calls. A tool server validates and records the actions; the world they
      // change is the harness's own, so applying them is the harness's job.
      if (outcome === "committed" && actions.length > 0) {
        const outcomes = await this.world.applyDecision(seat, actions as unknown as Array<Record<string, unknown>>);
        // What the world did is kept as well as what the seat asked for, so a
        // record never reports an action the world refused as though it happened.
        refused = outcomes
          .filter((entry) => !entry.taken)
          .map((entry) => ({ type: entry.type, reason: entry.reason ?? "no reason given" }));
      }
    } catch (failure) {
      outcome = "failed";
      error = failure instanceof Error ? failure.message : String(failure);
      // Give the harness a chance to repair the seat, so one lost backend does
      // not cost the rest of the game. A repaired seat restarts its context,
      // which the record states plainly.
      if (this.onTurnFailed) {
        try {
          // Only a replaced session restarts the seat's context. Clearing
          // stalled work leaves the history and the cache intact.
          contextReset = (await this.onTurnFailed(seat, error)) === "reset";
        } catch (repairFailure) {
          const detail = repairFailure instanceof Error ? repairFailure.message : String(repairFailure);
          error = error + "; repair failed: " + detail;
        }
      }
    }

    const record: TraceRecord = {
      runId: this.store.runId,
      game: this.world.game,
      seat,
      turn,
      startedAt,
      completedAt: new Date().toISOString(),
      observation,
      reasoning: result?.reasoning ?? null,
      modelText: result?.modelText ?? null,
      toolCalls: result?.toolCalls ?? [],
      usage: result?.usage ?? emptyUsage(),
      unknownParts: result?.unknownParts ?? [],
      outcome,
      applied: appliedSummary(actions, gaps),
      refused,
      error,
      contextReset,
      latencyMs: result?.latencyMs ?? 0
    };
    await this.store.record(record);
    return record;
  }

  // Serve the tool calls a seat made, in the order it made them. Serving is
  // sequential so that two calls in one turn cannot race over the same files.
  private async serveCalls(
    context: SeatContext,
    result: SeatTurnResult
  ): Promise<{ outcome?: "committed" | "passed"; gaps: Array<{ subject: string; detail?: string }>; actions: CommitAction[] }> {
    const gaps: Array<{ subject: string; detail?: string }> = [];
    let actions: CommitAction[] = [];
    let outcome: "committed" | "passed" | undefined;
    for (const call of result.toolCalls) {
      const input = (call.input ?? {}) as Record<string, unknown>;
      let handled;
      try {
        handled = await dispatchSeatTool(context, call.tool, input);
      } catch (failure) {
        handled = {
          text: "The tool failed: " + (failure instanceof Error ? failure.message : String(failure)),
          terminal: false
        };
      }
      if (handled.gap) gaps.push(handled.gap);
      if (handled.actions) actions = handled.actions;
      if (handled.outcome) outcome = handled.outcome;
    }
    return { outcome, gaps, actions };
  }
}

// Read what a tool server already did, from the results in the session.
// The runtime only classifies here: it decides how the turn ended, which
// actions were committed, and which inspects came back empty. It never
// re-applies anything, because the tool server has already applied it.
function readServedCalls(result: SeatTurnResult): {
  outcome?: "committed" | "passed";
  gaps: Array<{ subject: string; detail?: string }>;
  actions: CommitAction[];
} {
  const gaps: Array<{ subject: string; detail?: string }> = [];
  let outcome: "committed" | "passed" | undefined;
  let actions: CommitAction[] = [];
  for (const call of result.toolCalls) {
    const tool = call.tool.replace(/^vox-civ_/, "");
    const input = (call.input ?? {}) as Record<string, unknown>;
    if (tool === "commit_turn") {
      outcome = "committed";
      if (Array.isArray(input.actions)) actions = input.actions as CommitAction[];
    } else if (tool === "pass") {
      outcome = "passed";
    } else if (tool === "inspect" && typeof input.subject === "string" && isGapAnswer(call.output)) {
      gaps.push(
        typeof input.detail === "string"
          ? { subject: input.subject, detail: input.detail }
          : { subject: input.subject }
      );
    }
  }
  return { outcome, gaps, actions };
}

// Whether a tool answer was the simulation saying it holds no such state.
function isGapAnswer(output: string | null): boolean {
  return typeof output === "string" && output.includes("does not hold recorded state");
}

// The usage numbers for a turn that never got a response.
function emptyUsage(): SeatTurnResult["usage"] {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: null };
}

// One line describing what the turn did, so a reader of the record does not
// have to parse the tool calls to see the shape of the turn.
function appliedSummary(actions: CommitAction[], gaps: Array<{ subject: string; detail?: string }>): string {
  const parts: string[] = [];
  if (actions.length > 0) parts.push("committed " + actions.map((action) => action.type).join(", "));
  if (gaps.length > 0) {
    parts.push(
      "information gaps: " + gaps.map((gap) => gap.subject + (gap.detail ? " " + gap.detail : "")).join(", ")
    );
  }
  return parts.length > 0 ? parts.join("; ") : "nothing applied";
}
