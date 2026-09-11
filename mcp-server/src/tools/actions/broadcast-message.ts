/**
 * Tool for posting a public message to the world channel.
 *
 * The world channel is a single durable broadcast feed shared by every civilization
 * and the human observer: append-ordered by ID, visible to all. The speaker is
 * normally a major civilization's seat; the observer sentinel (-1) is allowed so a
 * human watching from outside the game can speak into the feed too.
 *
 * This tool is archival only: it does not stream, notify, or run agents. Readers
 * pull the feed with get-global-messages. Group messages in the Civ pilot ride this
 * feed as tagged lines ([#<id8> title] prefix), so group membership and inboxes can
 * be derived from the same authoritative store without another backing table.
 */

import { ToolBase } from "../base.js";
import * as z from "zod";
import { knowledgeManager } from "../../server.js";
import { composeVisibility } from "../../utils/knowledge/visibility.js";
import { readPublicKnowledgeBatch } from "../../utils/knowledge/cached.js";
import { getPlayerInformations } from "../../knowledge/getters/player-information.js";
import { MaxMajorCivs } from "../../knowledge/schema/base.js";
import { assertExpectedGame } from "../../utils/expected-game.js";

/** The observer / no-seat endpoint sentinel (shared with append-message). */
const OBSERVER_ID = -1;

/** Default role descriptor for the observer sentinel. */
const OBSERVER_ROLE = "observer";

/**
 * Input schema for the broadcast-message tool.
 */
const BroadcastMessageInputSchema = z.object({
  PlayerID: z.number().int().min(OBSERVER_ID).max(MaxMajorCivs - 1).describe("Speaker player ID (-1 for the human observer)"),
  Content: z.string().min(1).max(1000).describe("The message text broadcast to every civilization"),
  ReplyToID: z.number().int().optional().describe("Optional global message ID this replies to"),
  Turn: z.number().int().optional().describe("Game turn (defaults to the server's current turn)"),
  ExpectedGameID: z.string().min(1).optional().describe("Optional game identity guard"),
});

/**
 * Output schema: the stored message row's canonical fields.
 */
const BroadcastMessageOutputSchema = z.object({
  ID: z.number(),
  SpeakerID: z.number(),
  Turn: z.number(),
  Content: z.string(),
});

/**
 * Tool that posts one public message to the durable world channel.
 */
class BroadcastMessageTool extends ToolBase {
  readonly name = "broadcast-message";

  readonly description = "Post a public message to the world channel. Every civilization (and the human) can read broadcasts; they shape reputation and the world's narrative.";

  readonly inputSchema = BroadcastMessageInputSchema;

  readonly outputSchema = BroadcastMessageOutputSchema;

  readonly annotations = { readOnlyHint: false };

  readonly metadata = {
    autoComplete: ["PlayerID", "Content"],
  };

  async execute(args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    const { PlayerID, Content, ReplyToID, Turn, ExpectedGameID } = args;
    assertExpectedGame(this.name, ExpectedGameID);

    // Direct callers (tests, drivers) bypass zod parsing, so enforce the same
    // non-empty guard here that the schema describes for MCP callers.
    if (!Content || !Content.trim()) {
      throw new Error("Content is required");
    }

    // The observer may always speak; anything else must be a living major civ when
    // game state is available. Skipped wholesale when the cache is empty and the
    // fallback fetch returned nothing: there is nothing to validate against.
    if (PlayerID !== OBSERVER_ID) {
      const infos = await readPublicKnowledgeBatch("PlayerInformations", getPlayerInformations);
      if (infos.length > 0 && !infos.some((info) => info.Key === PlayerID && info.IsMajor === 1)) {
        throw new Error(`Player ${PlayerID} is not a major civilization`);
      }
    }

    // Repeat immediately before retaining the store reference: earlier validation
    // can await cache-backed reads, during which a GameSwitched event may replace
    // the active store.
    assertExpectedGame(this.name, ExpectedGameID);
    const store = knowledgeManager.getStore();
    const resolvedTurn = Turn !== undefined && Turn >= 0 ? Turn : knowledgeManager.getTurn();
    // The world channel is visible to every major civilization.
    const visibility = composeVisibility(
      Array.from({ length: MaxMajorCivs }, (_, i) => i)
    );
    const id = await store.storeTimedKnowledge("GlobalMessages", {
      data: {
        SpeakerID: PlayerID,
        SpeakerRole: PlayerID === OBSERVER_ID ? OBSERVER_ROLE : null,
        Content,
        ReplyToID: ReplyToID ?? null,
        Payload: {},
      },
      visibilityFlags: visibility,
      turn: Turn,
    });

    return {
      ID: id,
      SpeakerID: PlayerID,
      Turn: resolvedTurn,
      Content,
    };
  }
}

export default function createBroadcastMessageTool() {
  return new BroadcastMessageTool();
}
