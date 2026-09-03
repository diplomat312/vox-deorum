/**
 * Tool for reading the current game context without a snapshot lock.
 *
 * Unlike get-players (which takes the game lock and can wedge mid-turn
 * computation), this reads the knowledge manager's cached game identity:
 * game ID, current turn, and active player slot. It is the cheap, poll-safe
 * status source for drivers and dashboards that just need to know "what turn
 * are we on" without blocking the game.
 */

import { ToolBase } from "../base.js";
import * as z from "zod";
import { knowledgeManager } from "../../server.js";

const GetGameStatusInputSchema = z.object({}).describe("No arguments");

const GetGameStatusOutputSchema = z.object({
  gameID: z.string(),
  turn: z.number(),
  activePlayerId: z.number(),
});

class GetGameStatusTool extends ToolBase {
  readonly name = "get-game-status";

  readonly description = "Read the cached game context (game ID, current turn, active player) without a snapshot lock. Cheap and poll-safe.";

  readonly inputSchema = GetGameStatusInputSchema;

  readonly outputSchema = GetGameStatusOutputSchema;

  readonly annotations = { readOnlyHint: true };

  async execute(): Promise<z.infer<typeof this.outputSchema>> {
    return {
      gameID: knowledgeManager.getGameId(),
      turn: knowledgeManager.getTurn(),
      activePlayerId: knowledgeManager.getActivePlayerId(),
    };
  }
}

export default function createGetGameStatusTool() {
  return new GetGameStatusTool();
}

