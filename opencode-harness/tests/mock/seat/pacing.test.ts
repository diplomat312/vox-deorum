// Covers the pacing logic: what each policy holds, when a decision that landed
// on a moved state is still good, and the rule that a game is never left held.
//
// The clock here is a fake, which is the point: a pause that refuses, a pause
// that reports success while the game runs, and a seat that thinks for a long
// time are all conditions a real game produces occasionally and a test can
// produce on demand.

import { describe, expect, it } from "vitest";
import { SeatPacer, type GameClock } from "../../../src/seat/pacing.js";

// A game whose behaviour a test can dictate.
class FakeClock implements GameClock {
  // Whether a pause request is accepted.
  accepts = true;

  // Whether the game reports itself frozen after an accepted pause.
  reportsFrozen = true;

  // The turn the game is on.
  currentTurn = 4;

  // Every call made, so a test can prove what the pacer did to the clock.
  readonly calls: string[] = [];

  // How many turns the game advances when asked nothing, which stands in for a
  // game that carries on while a seat thinks.
  advanceOnTurnRead = 0;

  async pause(): Promise<boolean> {
    this.calls.push("pause");
    return this.accepts;
  }

  async resume(): Promise<boolean> {
    this.calls.push("resume");
    return true;
  }

  async turn(): Promise<number> {
    this.calls.push("turn");
    this.currentTurn += this.advanceOnTurnRead;
    return this.currentTurn;
  }

  async isFrozen(): Promise<boolean> {
    this.calls.push("isFrozen");
    return this.reportsFrozen;
  }

  // Whether the game is currently being held, which is false once released.
  get held(): boolean {
    const lastPause = this.calls.lastIndexOf("pause");
    const lastResume = this.calls.lastIndexOf("resume");
    return lastPause > lastResume && this.accepts;
  }
}

// The simplest possible decision: a technology a seat wants to research.
interface Decision {
  technology: string;
}

describe("pacing a seat's turn", () => {
  it("should hold the game for the whole thought under the freeze policy", async () => {
    const clock = new FakeClock();
    const pacer = new SeatPacer({ clock, policy: "freeze" });
    let heldWhileThinking = false;

    const result = await pacer.playTurn<Decision>({
      seat: "korea",
      turn: 4,
      decide: async () => {
        heldWhileThinking = clock.held;
        return { technology: "Pottery" };
      },
      stillValid: async () => true,
      commit: async () => undefined
    });

    expect(heldWhileThinking).toBe(true);
    expect(result.outcome.frozenForCognition).toBe(true);
    expect(result.outcome.frozenForCommit).toBe(true);
    expect(result.outcome.verdict).toBe("commit");
    expect(clock.held).toBe(false);
  });

  it("should let the game run while the seat thinks under the overlap policy", async () => {
    const clock = new FakeClock();
    const pacer = new SeatPacer({ clock, policy: "overlap" });
    let heldWhileThinking = false;
    let heldWhileCommitting = false;

    await pacer.playTurn<Decision>({
      seat: "korea",
      turn: 4,
      decide: async () => {
        heldWhileThinking = clock.held;
        return { technology: "Pottery" };
      },
      stillValid: async () => true,
      commit: async () => {
        heldWhileCommitting = clock.held;
      }
    });

    // The whole reason for the policy: the game is not stopped for the thought,
    // and is stopped to commit.
    expect(heldWhileThinking).toBe(false);
    expect(heldWhileCommitting).toBe(true);
  });

  it("should commit a decision that landed on the turn it reasoned about", async () => {
    const clock = new FakeClock();
    const pacer = new SeatPacer({ clock, policy: "overlap" });
    const committed: number[] = [];

    await pacer.playTurn<Decision>({
      seat: "korea",
      turn: 4,
      decide: async () => ({ technology: "Pottery" }),
      stillValid: async () => true,
      commit: async (_decision, turn) => {
        committed.push(turn);
      }
    });

    expect(committed).toEqual([4]);
  });

  it("should keep a decision that landed late but is still valid", async () => {
    const clock = new FakeClock();
    clock.advanceOnTurnRead = 1;
    const pacer = new SeatPacer({ clock, policy: "overlap" });
    const committed: number[] = [];

    const result = await pacer.playTurn<Decision>({
      seat: "korea",
      turn: 4,
      decide: async () => ({ technology: "Pottery" }),
      stillValid: async () => true,
      commit: async (_decision, turn) => {
        committed.push(turn);
      }
    });

    // The game moved a turn while the seat thought, and the decision survived
    // the check, so it is committed on the turn it will land on.
    expect(committed).toEqual([5]);
    expect(result.outcome.verdict).toBe("revalidated");
  });

  it("should try again when the game refuses to hold", async () => {
    const clock = new FakeClock();
    // A game refuses the first request and accepts the second, which is what
    // the recorded game's occasional refused pause looked like.
    let attempts = 0;
    clock.pause = async () => {
      attempts += 1;
      clock.calls.push("pause");
      return attempts >= 2;
    };
    const pacer = new SeatPacer({ clock, policy: "freeze" });

    const result = await pacer.playTurn<Decision>({
      seat: "korea",
      turn: 4,
      decide: async () => ({ technology: "Pottery" }),
      stillValid: async () => true,
      commit: async () => undefined
    });

    expect(attempts).toBe(2);
    expect(result.outcome.frozenForCognition).toBe(true);
  });

  it("should not treat a pause that lies as a held game", async () => {
    const clock = new FakeClock();
    // The recorded game showed a pause reporting success while the game carried
    // on advancing. A hold is only a hold if the game says it is holding.
    clock.accepts = true;
    clock.reportsFrozen = false;
    const pacer = new SeatPacer({ clock, policy: "freeze" });
    let committed = 0;

    const result = await pacer.playTurn<Decision>({
      seat: "korea",
      turn: 4,
      decide: async () => ({ technology: "Pottery" }),
      stillValid: async () => true,
      commit: async () => {
        committed += 1;
      }
    });

    expect(result.outcome.frozenForCognition).toBe(false);
    // The decision was still taken, because the game did answer the turn it was
    // asked about, but the record does not claim the game was held.
    expect(committed).toBe(1);
    expect(clock.calls.filter((call) => call === "isFrozen").length).toBeGreaterThanOrEqual(3);
  });

  it("should release the game even when the seat's own work throws", async () => {
    const clock = new FakeClock();
    const pacer = new SeatPacer({ clock, policy: "freeze" });

    await expect(
      pacer.playTurn<Decision>({
        seat: "korea",
        turn: 4,
        decide: async () => {
          throw new Error("the model call failed");
        },
        stillValid: async () => true,
        commit: async () => undefined
      })
    ).rejects.toThrowError(/the model call failed/);

    // A game left held is worse than a failed turn, because it stops the whole
    // game rather than one seat. The release is not conditional on success.
    expect(clock.held).toBe(false);
    expect(clock.calls).toContain("resume");
  });

  it("should drop a decision when the hold ran past its budget", async () => {
    const clock = new FakeClock();
    clock.advanceOnTurnRead = 1;
    // A budget of nothing means the first check finds the game already overdue,
    // which is the state a seat that thought for far too long would leave it in.
    const pacer = new SeatPacer({ clock, policy: "overlap", freezeBudgetMs: 0 });
    let committed = 0;

    const result = await pacer.playTurn<Decision>({
      seat: "korea",
      turn: 4,
      decide: async () => ({ technology: "Pottery" }),
      stillValid: async () => true,
      commit: async () => {
        committed += 1;
      }
    });

    expect(committed).toBe(0);
    expect(result.outcome.verdict).toBe("abandoned");
  });

  it("should never touch the clock under the none policy", async () => {
    const clock = new FakeClock();
    const pacer = new SeatPacer({ clock, policy: "none" });
    let committed = 0;

    await pacer.playTurn<Decision>({
      seat: "korea",
      turn: 4,
      decide: async () => ({ technology: "Pottery" }),
      stillValid: async () => true,
      commit: async () => {
        committed += 1;
      }
    });

    expect(committed).toBe(1);
    expect(clock.calls).not.toContain("pause");
    expect(clock.calls).not.toContain("resume");
  });

  it("should drop a decision the moved state invalidates", async () => {
    const clock = new FakeClock();
    clock.advanceOnTurnRead = 1;
    const pacer = new SeatPacer({ clock, policy: "overlap" });
    let commitCalls = 0;

    const result = await pacer.playTurn<Decision>({
      seat: "korea",
      turn: 4,
      decide: async () => ({ technology: "Pottery" }),
      stillValid: async () => false,
      commit: async () => {
        commitCalls += 1;
      }
    });

    // A seat must never set a technology another seat took first, so the
    // decision is dropped rather than sent on a state it no longer fits.
    expect(commitCalls).toBe(0);
    expect(result.decision).toBeNull();
    expect(result.outcome.verdict).toBe("abandoned");
  });
});
