/**
 * Tool for posting a message to the world (global) channel.
 *
 * Global messages are stored in the per-game GlobalMessages feed and made visible to
 * every civilization. The speaker is normally a major civilization's seat; the observer
 * sentinel (-1) is allowed so the human can speak into the world channel too.
 */
import { ToolBase } from "../base.js";
import * as z from "zod";
import { knowledgeManager } from "../../server.js";
import { composeVisibility } from "../../utils/knowledge/visibility.js";
import { MaxMajorCivs } from "../../knowledge/schema/base.js";
import { assertExpectedGame } from "../../utils/expected-game.js";
const OBSERVER_ID = -1;
const BroadcastMessageInputSchema = z.object({
    PlayerID: z.number().int().min(OBSERVER_ID).max(MaxMajorCivs - 1).describe("Speaker player ID (-1 for the human observer)"),
    Content: z.string().min(1).describe("The message text broadcast to every civilization"),
    ReplyToID: z.number().int().optional().describe("Optional global message ID this replies to"),
    Turn: z.number().int().optional().describe("Game turn (defaults to the server's current turn)"),
    ExpectedGameID: z.string().min(1).optional().describe("Optional game identity guard"),
});
const BroadcastMessageOutputSchema = z.object({
    ID: z.number(),
    SpeakerID: z.number(),
    Turn: z.number(),
    Content: z.string(),
});
class BroadcastMessageTool extends ToolBase {
    name = "broadcast-message";
    description = "Post a public message to the world channel. Every civilization (and the human) can read broadcasts; they shape reputation and the world's narrative.";
    inputSchema = BroadcastMessageInputSchema;
    outputSchema = BroadcastMessageOutputSchema;
    annotations = { readOnlyHint: false };
    metadata = { autoComplete: ["PlayerID", "Content"] };
    async execute(args) {
        assertExpectedGame(this.name, args.ExpectedGameID);
        const store = knowledgeManager.getStore();
        const resolvedTurn = args.Turn !== undefined && args.Turn >= 0 ? args.Turn : knowledgeManager.getTurn();
        const id = await store.storeTimedKnowledge("GlobalMessages", {
            data: {
                SpeakerID: args.PlayerID,
                SpeakerRole: args.PlayerID === OBSERVER_ID ? "observer" : undefined,
                Content: args.Content,
                ReplyToID: args.ReplyToID ?? null,
            },
            visibilityFlags: composeVisibility(Array.from({ length: MaxMajorCivs }, (_, i) => i)),
            turn: resolvedTurn,
        });
        return { ID: id, SpeakerID: args.PlayerID, Turn: resolvedTurn, Content: args.Content };
    }
}
export default function createBroadcastMessageTool() {
    return new BroadcastMessageTool();
}
