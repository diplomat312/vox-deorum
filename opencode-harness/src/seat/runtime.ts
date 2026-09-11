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
  // Send one observation to a seat and read back what it did.
  sendObservation(seat: string, observation: string): Promise<SeatTurnResult>;
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
}

// Plays turns for the seats of one run.
export class SeatRuntime {
  // The session that answers for each seat.
  private readonly client: SessionDriver;

  // The state source the seats read.
  private readonly world: World;

  // Where the run keeps its social log.
  private readonly socialDirectory: string;

  // Where the run's record is written.
  private readonly store: TraceStore;

  // Who answers the seat's tool calls.
  private readonly toolServing: "serve" | "observe";

  // Build a runtime for one run.
  constructor(options: SeatRuntimeOptions) {
    this.client = options.client;
    this.world = options.world;
    this.socialDirectory = options.socialDirectory;
    this.store = options.store;
    this.toolServing = options.toolServing ?? "serve";
  }

  // Play one turn for one seat and record it. A turn that produces no terminal
  // call is recorded as unfinished rather than being retried silently, because
  // a seat that never decided is a fact about the run.
  async playTurn(seat: string, turn: number): Promise<TraceRecord> {
    const startedAt = new Date().toISOString();
    await this.world.beginTurn(seat, turn);
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

    try {
      result = await this.client.sendObservation(seat, observation);
      if (this.toolServing === "serve") {
        const servedCalls = await this.serveCalls(context, result);
        gaps = servedCalls.gaps;
        if (servedCalls.outcome) outcome = servedCalls.outcome;
        actions = servedCalls.actions;
      } else {
        const observed = readServedCalls(result);
        gaps = observed.gaps;
        if (observed.outcome) outcome = observed.outcome;
        actions = observed.actions;
      }
    } catch (failure) {
      outcome = "failed";
      error = failure instanceof Error ? failure.message : String(failure);
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
      error,
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
