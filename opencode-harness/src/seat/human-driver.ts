// Lets a person play one seat.
//
// A human seat is a seat whose decision comes from someone reading the same
// briefing a model reads. Nothing else about the run changes: the same runtime,
// the same four tools, the same trace and the same report, so a game with a
// person in it is measured the same way as one without.
//
// The exchange is files, deliberately. Writing the observation to a known place
// and waiting for a decision in another is a protocol a person can play by hand
// with an editor, and a user interface can adopt later without the runtime
// learning anything new.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SeatTurnResult, SessionToolCall } from "../session/types.js";
import type { SessionDriver } from "./runtime.js";
import { logger } from "../utils/logger.js";

// The file a seat's turn is published to.
export const pendingFileName = "pending-turn.json";

// The file a person writes their decision to.
export const decisionFileName = "decision.json";

// The file a person writes an inspect request to, and the answer beside it.
export const requestFileName = "request.json";
export const answerFileName = "answer.json";

// What a person decided to do with a turn.
export interface HumanDecision {
  // Whether to commit actions or do nothing this turn.
  kind: "commit" | "pass";
  // Why, in the person's own words. This is kept as the seat's reasoning,
  // because for a person the rationale is the thinking.
  rationale?: string;
  // The game actions to commit, in the shape a model seat commits them.
  actions?: unknown[];
  // Social operations to apply, in the shape a model seat sends them.
  operations?: unknown[];
}

// What a person asked to see before deciding.
export interface HumanInspectRequest {
  // The subject to read, as the inspect tool names it.
  subject: string;
  // Anything that refines the subject.
  detail?: string;
}

// Everything a person is handed at the start of their turn.
export interface PendingTurn {
  // The seat being played.
  seat: string;
  // The turn being played.
  turn: number;
  // The briefing, identical to what a model seat would receive.
  observation: string;
  // When the turn was offered, so a person can see how long they have.
  offeredAt: string;
  // How long they have, in milliseconds.
  timeoutMs: number;
  // How to answer, written where the person will see it.
  howToAnswer: string;
}

// Everything the human seat needs.
export interface HumanSeatOptions {
  // The seat this driver plays.
  seat: string;
  // Where the exchange files live, which is the seat's own directory.
  directory: string;
  // How long to wait for a decision before giving up.
  timeoutMs?: number;
  // How often to look for a decision.
  pollMs?: number;
  // Answers an inspect the person asks for. A person cannot read the game
  // themselves, so the run supplies this.
  answerInspect?: (request: HumanInspectRequest) => Promise<string>;
}

// How long a person has to decide, when the run does not say.
const defaultTimeoutMs = 1800000;

// How often to look, when the run does not say.
const defaultPollMs = 1000;

// Read a JSON file, or null when it is missing or unreadable.
async function readJson(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

// Wait for a short while.
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Turn a person's decision into the tool calls a seat would have made, so the
// runtime serves them exactly as it serves a model's.
export function decisionToToolCalls(decision: HumanDecision): SessionToolCall[] {
  const calls: SessionToolCall[] = [];
  if (Array.isArray(decision.operations) && decision.operations.length > 0) {
    calls.push({
      tool: "vox-civ_communicate",
      callID: "human-communicate",
      status: "completed",
      input: { operations: decision.operations },
      output: null,
      error: null
    });
  }
  if (decision.kind === "pass") {
    calls.push({
      tool: "vox-civ_pass",
      callID: "human-pass",
      status: "completed",
      input: { rationale: decision.rationale ?? "" },
      output: null,
      error: null
    });
    return calls;
  }
  calls.push({
    tool: "vox-civ_commit_turn",
    callID: "human-commit",
    status: "completed",
    input: { rationale: decision.rationale ?? "", actions: Array.isArray(decision.actions) ? decision.actions : [] },
    output: null,
    error: null
  });
  return calls;
}

// Plays a seat by asking a person.
export class HumanSeatDriver implements SessionDriver {
  // The seat being played, which labels the turn it is offered.
  private readonly seat: string;

  // Where the exchange files live.
  private readonly directory: string;

  // How long to wait for a decision.
  private readonly timeoutMs: number;

  // How often to look.
  private readonly pollMs: number;

  // Answers an inspect the person asks for.
  private readonly answerInspect?: (request: HumanInspectRequest) => Promise<string>;

  // Build a driver for one human seat.
  constructor(options: HumanSeatOptions) {
    this.seat = options.seat;
    this.directory = options.directory;
    this.timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    this.pollMs = options.pollMs ?? defaultPollMs;
    this.answerInspect = options.answerInspect;
  }

  // The path of one of the exchange files.
  private file(name: string): string {
    return path.join(this.directory, name);
  }

  // Offer the turn, then wait for a decision, answering any inspect the person
  // asks for while they think.
  async sendObservation(seat: string, observation: string, turn: number): Promise<SeatTurnResult> {
    // A person's exchange files belong to one seat, so a turn offered to the
    // wrong seat is a mistaken wiring rather than something to serve.
    if (seat !== this.seat) {
      throw new Error("This human seat plays '" + this.seat + "', and was asked for '" + seat + "'");
    }
    await mkdir(this.directory, { recursive: true });
    const started = Date.now();
    // A decision left over from an earlier turn must never be read as this
    // turn's, so the file is cleared before the turn is offered.
    await rm(this.file(decisionFileName), { force: true });
    await rm(this.file(requestFileName), { force: true });
    await rm(this.file(answerFileName), { force: true });
    await writeFile(
      this.file(pendingFileName),
      JSON.stringify(
        {
          seat,
          turn,
          observation,
          offeredAt: new Date().toISOString(),
          timeoutMs: this.timeoutMs,
          howToAnswer:
            "Write " +
            decisionFileName +
            " in this directory with {kind: 'commit'|'pass', rationale, actions, operations}. " +
            "To look something up first, write " +
            requestFileName +
            " with {subject, detail} and read " +
            answerFileName +
            " for the answer."
        } satisfies PendingTurn,
        null,
        2
      ),
      "utf8"
    );
    logger.info("Turn " + turn + " is waiting for the person playing " + seat + " in " + this.directory);

    const deadline = started + this.timeoutMs;
    for (;;) {
      const requestRaw = await readJson(this.file(requestFileName));
      if (requestRaw !== null && typeof requestRaw === "object") {
        await this.answer(requestRaw as HumanInspectRequest, turn);
      }
      const decisionRaw = await readJson(this.file(decisionFileName));
      if (decisionRaw !== null && typeof decisionRaw === "object") {
        const decision = decisionRaw as HumanDecision;
        if (decision.kind === "commit" || decision.kind === "pass") {
          // The answer is kept rather than deleted, so a person can see what
          // they decided after the fact.
          logger.info("The person playing " + seat + " chose to " + decision.kind + " on turn " + turn);
          return {
            session: "human:" + seat,
            model: "human",
            reasoning: typeof decision.rationale === "string" ? decision.rationale : null,
            modelText: null,
            toolCalls: decisionToToolCalls(decision),
            usage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: null },
            latencyMs: Date.now() - started,
            unknownParts: []
          };
        }
      }
      if (Date.now() >= deadline) {
        throw new Error(
          "The person playing " + seat + " did not decide on turn " + turn + " within " + this.timeoutMs + "ms"
        );
      }
      await delay(this.pollMs);
    }
  }

  // Answer an inspect the person asked for, and clear the request so it is
  // answered once rather than on every look.
  private async answer(request: HumanInspectRequest, turn: number): Promise<void> {
    let text: string;
    if (!this.answerInspect || typeof request.subject !== "string") {
      text = "The run cannot answer that request.";
    } else {
      try {
        text = await this.answerInspect({ subject: request.subject, detail: request.detail });
      } catch (failure) {
        text = "That request failed: " + (failure instanceof Error ? failure.message : String(failure));
      }
    }
    await writeFile(this.file(answerFileName), JSON.stringify({ turn, subject: request.subject, text }, null, 2), "utf8");
    await rm(this.file(requestFileName), { force: true });
  }
}
