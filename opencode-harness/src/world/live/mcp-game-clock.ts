// The game clock, reached through the MCP tools.
//
// Every part of this goes through the same door as everything else, so a seat
// holds and releases the game with the game's own actions rather than by a
// private route. The one interesting piece is deciding whether the game is
// actually holding still: there is no tool that answers that, so it is inferred
// the way the recorded game's harness learned to, by asking the turn twice and
// seeing whether it moved.

import type { VoxConnector } from "./vox-connector.js";
import type { GameClock } from "../../seat/pacing.js";
import { logger } from "../../utils/logger.js";

// The key the knowledge store holds the current turn under.
const turnKey = "turn";

// How long to wait between the two reads that decide whether the game is
// holding, in milliseconds. Long enough that a running game would have moved.
const freezeSettleMs = 250;

// Wait for a short while.
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The game clock over the MCP tools.
export class McpGameClock implements GameClock {
  // The connection to the game.
  private readonly connector: VoxConnector;

  // The seat the pause is attributed to, which the game's own action requires.
  private readonly playerID: number;

  // How long to wait before the second read that decides whether the game held.
  private readonly settleMs: number;

  // Build a clock over one game, acting for one seat.
  constructor(connector: VoxConnector, playerID: number, settleMs: number = freezeSettleMs) {
    this.connector = connector;
    this.playerID = playerID;
    this.settleMs = settleMs;
  }

  // Ask the game to hold.
  async pause(): Promise<boolean> {
    const result = await this.connector.call("pause-game", { PlayerID: this.playerID }).catch(() => null);
    if (!result || result.isError) return false;
    // The tool answers with a plain boolean, so the text is read as one rather
    // than as a payload.
    return result.text.trim().toLowerCase().startsWith("true");
  }

  // Let the game run again.
  async resume(): Promise<boolean> {
    const result = await this.connector.call("resume-game", { PlayerID: this.playerID }).catch(() => null);
    if (!result || result.isError) return false;
    return result.text.trim().toLowerCase().startsWith("true");
  }

  // The turn the game is on, read from the knowledge store's own metadata.
  async turn(): Promise<number> {
    const result = await this.connector.call("get-metadata", { Key: turnKey });
    if (result.isError) throw new Error("The game would not say which turn it is on: " + result.text.slice(0, 160));
    // The metadata tool answers with the value rather than a payload, and an
    // unknown key answers with nothing at all. Empty is checked before the
    // conversion because the number zero is a perfectly good turn, so an empty
    // answer would otherwise read as turn zero and two unreadable reads would
    // compare equal, reporting a game as held when it was never read.
    const trimmed = result.text.trim().replace(/^"|"$/g, "");
    if (trimmed === "") {
      throw new Error("The game answered with no turn at all, so it cannot be read");
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      throw new Error("The game answered with a turn that is not a number: " + result.text.slice(0, 80));
    }
    return parsed;
  }

  // Whether the game is actually holding still.
  //
  // A pause is a request, and the recorded game showed it can be accepted while
  // the game advances anyway. So the answer is read rather than inferred: ask
  // the turn, wait, ask again, and a game that did not move is a game that held.
  async isFrozen(): Promise<boolean> {
    try {
      const before = await this.turn();
      await delay(this.settleMs);
      const after = await this.turn();
      if (before !== after) {
        logger.warn("The game was asked to hold and advanced from turn " + before + " to " + after);
      }
      return before === after;
    } catch (error) {
      // A game that cannot say what turn it is on cannot be confirmed as held,
      // and treating an unknown as held would be the unsafe direction.
      logger.warn("Could not confirm the game held: " + String(error));
      return false;
    }
  }
}
