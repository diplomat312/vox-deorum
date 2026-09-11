// How a seat's thinking relates to the game clock.
//
// This is the one part of the live path that cannot be proven without a game,
// because it exists to cope with a clock that moves underneath a seat. What can
// be proven without one is the logic: the decision a policy makes, the check
// that a decision is still valid when it lands, and the rule that stops a seat
// holding a game frozen forever. The game itself is reached through one small
// interface, so a clock that pretends to move is enough to test all of it.
//
// The problem this exists for was measured on a recorded game: a seat's thinking
// took fifteen to fifty seconds while the native turns it was interleaving with
// took under a second, and the pause the old harness relied on was advisory.
// Two things follow, and both are here: a decision must be checked against the
// state it will land on, and a game must never be held frozen past a budget.

import { logger } from "../utils/logger.js";

// What a seat decides about the game clock.
export type PacingPolicy =
  // Hold the game still for the whole cognition. The decision cannot be stale,
  // and the world waits for every seat on every turn.
  | "freeze"
  // Let the game run while the seat thinks, then hold it only to confirm and
  // commit. A decision can land on a state that moved, so it is checked.
  | "overlap"
  // Never touch the clock. A decision lands whenever it lands, and is checked
  // the same way.
  | "none";

// The game, as far as pacing is concerned.
export interface GameClock {
  // Ask the game to hold still. Reports whether it took, because a pause is a
  // request rather than a guarantee and the harness has to know the difference.
  pause(): Promise<boolean>;
  // Let the game run again.
  resume(): Promise<boolean>;
  // The turn the game is on.
  turn(): Promise<number>;
  // Whether the game is actually holding still, which is not the same as having
  // asked it to. A recorded game showed a pause reporting success while the game
  // advanced, so the answer is read rather than inferred.
  isFrozen(): Promise<boolean>;
}

// How one seat's turn was paced, for the record.
export interface PacingOutcome {
  // The policy that ran.
  policy: PacingPolicy;
  // Whether the game was held while the seat thought.
  frozenForCognition: boolean;
  // Whether the game was held at the moment of the commit.
  frozenForCommit: boolean;
  // How long the game was held in total, in milliseconds.
  frozenMs: number;
  // The turn the seat reasoned about.
  reasonedTurn: number;
  // The turn the decision landed on.
  commitTurn: number;
  // What was done about a decision that landed on a different turn.
  verdict: CommitVerdict;
}

// What to do with a decision when it lands.
export type CommitVerdict =
  // The state did not move, so the decision stands.
  | "commit"
  // The state moved and the decision was checked against the new state, so it
  // stands because it is still legal and still makes sense.
  | "revalidated"
  // The state moved in a way that invalidates the decision, so it is not sent
  // and the seat is asked again on the current state.
  | "abandoned"
  // The game could not be held at all, so nothing was committed on a state the
  // seat could have misread.
  | "unpaced";

// Everything a pacer needs.
export interface PacingOptions {
  // The game.
  clock: GameClock;
  // The policy to apply.
  policy: PacingPolicy;
  // How long the game may be held in one turn before the harness gives up on
  // holding it, in milliseconds. A seat must never freeze a game indefinitely.
  freezeBudgetMs?: number;
  // How many times to ask a game to hold still before accepting that it will
  // not, which is what the recorded game's occasional refused pause requires.
  pauseAttempts?: number;
}

// How long the game may be held, when the caller does not say. Ten seconds is
// long enough to confirm and commit a decision and short enough that a person
// watching would not call the game hung.
const defaultFreezeBudgetMs = 10000;

// How many times to ask, when the caller does not say.
const defaultPauseAttempts = 3;

// Wait for a short while.
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Holds a game still only as long as it is allowed to.
//
// The budget is the point. A pause that no one releases is worse than a stale
// decision, because it stops the whole game rather than one seat's turn, so the
// release happens even when the work in between throws.
export class PacingClock {
  // How long the game may be held in one turn.
  private readonly budgetMs: number;

  // How many times to ask before accepting a refusal.
  private readonly attempts: number;

  // When the game was first asked to hold in this turn, or null when it is not
  // being held.
  private heldSince: number | null = null;

  // How long the game was held in this turn, in milliseconds.
  private heldMs = 0;

  // How many times the game was successfully held in this turn. Counted separately from the elapsed time, because a hold that completes within the same millisecond is still a hold, and deciding by duration would treat a fast success as a failure.
  private holds = 0;

  // The game.
  readonly clock: GameClock;

  // Build a pacer over one game.
  constructor(clock: GameClock, budgetMs: number, attempts: number) {
    this.clock = clock;
    this.budgetMs = budgetMs;
    this.attempts = attempts;
  }

  // Ask the game to hold still, and confirm that it did.
  //
  // Both halves matter. The request can be refused, and it can report success
  // while the game carries on, so a held game is one that answers as frozen
  // rather than one that answered politely.
  async hold(): Promise<boolean> {
    for (let attempt = 1; attempt <= this.attempts; attempt += 1) {
      const accepted = await this.clock.pause().catch(() => false);
      if (accepted && (await this.clock.isFrozen().catch(() => false))) {
        if (this.heldSince === null) this.heldSince = Date.now();
        this.holds += 1;
        return true;
      }
      logger.warn("The game did not hold on attempt " + attempt + " of " + this.attempts);
      await delay(250 * attempt);
    }
    return false;
  }

  // Let the game run again, and record how long it was held.
  async release(): Promise<void> {
    if (this.heldSince === null) return;
    this.heldMs += Date.now() - this.heldSince;
    this.heldSince = null;
    await this.clock.resume().catch(() => false);
  }

  // How long the game has been held in this turn.
  // Whether the game was held at all in this turn.
  get wasHeld(): boolean {
    return this.holds > 0;
  }

  // How often the game was held in this turn.
  get holdCount(): number {
    return this.holds;
  }

  get heldFor(): number {
    return this.heldMs + (this.heldSince === null ? 0 : Date.now() - this.heldSince);
  }

  // Whether the game has been held as long as it is allowed to be.
  get outOfBudget(): boolean {
    return this.heldFor >= this.budgetMs;
  }

  // The budget this pacer holds to.
  get budget(): number {
    return this.budgetMs;
  }
}

// Everything one paced turn needs.
export interface PacedTurnOptions<T> {
  // The seat being played, for the log.
  seat: string;
  // The turn being played, which is the state the seat will reason about.
  turn: number;
  // The work that produces a decision. Called with the turn it should reason
  // about, so a policy that moves the clock can ask for the work again on a
  // newer state without the caller caring.
  decide: (turn: number) => Promise<T>;
  // Whether the decision is still valid on a given turn. Only the caller knows
  // what makes a decision stale, such as a technology another seat took first,
  // so this is asked rather than assumed.
  stillValid: (decision: T, turn: number) => Promise<boolean>;
  // What to do with a decision that stands.
  commit: (decision: T, turn: number) => Promise<void>;
  // What to do with a decision the check threw away. A dropped decision was
  // still a turn the seat played, so a caller that keeps a record needs a chance
  // to write it down rather than let the turn vanish from the run.
  onDropped?: (decision: T, turn: number, verdict: CommitVerdict) => Promise<void>;
  // How long the game may be held in this turn, overriding the pacer default.
  freezeBudgetMs?: number;
}

// A decision that was reached, and what became of it.
export interface PacedTurnResult<T> {
  // The decision, when one was reached and stood. Null when the turn produced
  // nothing the caller could commit.
  decision: T | null;
  // How the turn was paced.
  outcome: PacingOutcome;
}

// Runs one seat's turn against the clock under a policy.
export class SeatPacer {
  // The game, and the budget this pacer holds it to.
  private readonly pacing: PacingClock;

  // The policy being applied.
  private readonly policy: PacingPolicy;

  // Build a pacer over one game.
  constructor(options: PacingOptions) {
    const budget = options.freezeBudgetMs ?? defaultFreezeBudgetMs;
    const attempts = options.pauseAttempts ?? defaultPauseAttempts;
    this.pacing = new PacingClock(options.clock, budget, attempts);
    this.policy = options.policy;
  }

  // Play one turn under the policy.
  //
  // The three policies differ in exactly one thing: what is held while the seat
  // thinks. A frozen game cannot produce a stale decision, an overlapped one
  // can, and an unpaced one always might.
  async playTurn<T>(options: PacedTurnOptions<T>): Promise<PacedTurnResult<T>> {
    const clock = this.pacing;
    let frozenForCognition = false;
    let frozenForCommit = false;
    let reasonedTurn = options.turn;
    let commitTurn = options.turn;
    let verdict: CommitVerdict = "commit";
    let decision: T | null = null;
    try {
      if (this.policy === "freeze") {
        // Hold first, then think. The seat cannot read a state that moves.
        frozenForCognition = await clock.hold();
        reasonedTurn = await this.turnOr(options.turn);
        decision = await options.decide(reasonedTurn);
        frozenForCommit = frozenForCognition;
        commitTurn = await this.turnOr(reasonedTurn);
      } else {
        // Think first, then hold to confirm. This is where a decision can be
        // stale, so the check below is the point of the policy rather than a
        // formality.
        decision = await options.decide(options.turn);
        if (this.policy === "overlap") {
          frozenForCommit = await clock.hold();
          commitTurn = await this.turnOr(options.turn);
        } else {
          commitTurn = await this.turnOr(options.turn);
        }
      }

      verdict = await this.check(clock, reasonedTurn, commitTurn, decision, options);
      if (verdict === "commit" || verdict === "revalidated") {
        await options.commit(decision, commitTurn);
      } else {
        // The turn happened even though nothing came of it, so the caller is
        // told rather than left with a gap where a turn should be.
        if (options.onDropped) await options.onDropped(decision, commitTurn, verdict);
        decision = null;
      }
    } finally {
      // The release happens whatever happened above. A game left held is worse
      // than any decision this turn could have produced.
      await clock.release();
    }
    const outcome: PacingOutcome = {
      policy: this.policy,
      frozenForCognition,
      frozenForCommit,
      frozenMs: clock.heldFor,
      reasonedTurn,
      commitTurn,
      verdict
    };
    if (verdict !== "commit" && verdict !== "revalidated") {
      logger.warn(
        "Seat " + options.seat + " produced no commit on turn " + options.turn + ": " + verdict
      );
    }
    return { decision, outcome };
  }

  // Work out what to do with a decision that has landed.
  private async check<T>(
    clock: PacingClock,
    reasonedTurn: number,
    commitTurn: number,
    decision: T,
    options: PacedTurnOptions<T>
  ): Promise<CommitVerdict> {
    // A seat that never held the game at all committed on a state it could
    // have misread, and the record should say so rather than implying a check
    // that never happened.
    if (this.policy === "overlap" && !clock.wasHeld) return "unpaced";
    if (reasonedTurn === commitTurn) return "commit";
    // The state moved. A decision that is still valid stands, and a budget that
    // ran out is itself a reason not to trust one that is not.
    if (clock.outOfBudget) {
      logger.warn("The game was held past its budget, so the decision was dropped rather than risked");
      return "abandoned";
    }
    const valid = await options.stillValid(decision, commitTurn).catch(() => false);
    return valid ? "revalidated" : "abandoned";
  }

  // The turn the game is on, falling back to what the caller said when the game
  // cannot be asked.
  private async turnOr(fallback: number): Promise<number> {
    return this.pacing.clock.turn().catch(() => fallback);
  }
}
