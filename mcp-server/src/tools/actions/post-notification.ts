/**
 * Tool for posting a native in-game notification to a player.
 *
 * General-purpose: a diplomacy reply sets CounterpartID so clicking the
 * notification opens the conversation; any other LLM->human message omits it, and
 * clicking then shows Message in a text dialog. The notification is delivered by
 * civ5-mod's NOTIFICATION_VOX_DEORUM_DIPLOMACY type and survives
 * across turns until the player dismisses it.
 *
 * This replaces the previously mod-registered VoxDeorumPostNotification: a UI
 * context that called Game.RegisterFunction at load ran before
 * CvConnectionService::Setup() and crashed the game. Registering through the
 * server's LuaFunction machinery (which runs in the ConnectionService Lua state
 * after the bridge connects) is the safe path.
 */

import { LuaFunctionTool } from "../abstract/lua-function.js";
import * as z from "zod";
import { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { MaxMajorCivs, MaxPlayers } from "../../knowledge/schema/base.js";
import { eventPipeDelimiter } from "../../bridge/protocol.js";
/** Sentinel counterpart for a notification with no diplomacy target. */
const NO_COUNTERPART = -1;

/** Civ V markup used by the game's notification headlines. */
const HIGHLIGHT_START = "[COLOR_POSITIVE_TEXT]";
const HIGHLIGHT_END = "[ENDCOLOR]";

/** Maximum notification body length after truncation, including the ellipsis. */
const MESSAGE_LIMIT = 400;
const ELLIPSIS = "...";

/** Normalize notification text and reject content that becomes blank at the IPC boundary. */
function normalizeNotificationText(text: string, field: "Summary" | "Message"): string {
  const normalized = text.split(eventPipeDelimiter).join("").trim();
  if (!normalized) {
    throw new Error(`${field} must contain visible text after IPC sanitization`);
  }
  return normalized;
}

/** Format a notification summary like the highlighted headlines used by the game. */
function highlightNotificationSummary(summary: string): string {
  return `${HIGHLIGHT_START}${summary}${HIGHLIGHT_END}`;
}

/** Fit a notification body to the game's readable tooltip length. */
function truncateNotificationMessage(message: string): string {
  if (message.length <= MESSAGE_LIMIT) return message;
  return `${message.slice(0, MESSAGE_LIMIT - ELLIPSIS.length).trimEnd()}${ELLIPSIS}`;
}

/**
 * Input schema for the post-notification tool.
 */
const PostNotificationInputSchema = z.object({
  // The recipient spans the FULL addressable player range, not just the major civs: a human
  // watching from an observer slot is a real notification recipient (see the pinned-observer
  // redirect in post-notification.lua). The counterpart is a conversation partner, so it stays
  // bounded by the major civilizations.
  PlayerID: z.number().int().min(0).max(MaxPlayers - 1)
    .describe("The player slot that receives the notification: a major civilization, or an observer slot (0 to MAX_PLAYERS - 1)"),
  CounterpartID: z.number().int().min(0).max(MaxMajorCivs - 1).optional()
    .describe("Optional diplomacy counterpart (a major civilization): when set, clicking opens the conversation with this player; when omitted, clicking shows Message in a dialog"),
  Summary: z.string().min(1).max(200)
    .describe("Short notification headline (highlighted in the notification panel)"),
  Message: z.string().min(1).max(2000)
    .describe("Notification body (shown as a tooltip and in the dialog for counterpart-less notifications; truncated to 400 characters)"),
});

/**
 * Tool that posts one native in-game notification.
 */
class PostNotificationTool extends LuaFunctionTool<boolean> {
  readonly name = "post-notification";

  readonly description = "Post a native in-game notification to a human player. Set CounterpartID for a diplomacy reply; omit it for a general message.";

  readonly inputSchema = PostNotificationInputSchema;

  protected readonly resultSchema = z.boolean();

  protected get arguments() { return ["playerID", "counterpartID", "summary", "message"]; }

  protected readonly scriptFile = "post-notification.lua";

  readonly annotations: ToolAnnotations = { readOnlyHint: false };

  readonly metadata = {
    autoComplete: ["PlayerID"],
  };

  /** Validate notification invariants, sanitize its text, and post it through Lua. */
  async execute(args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    if (args.CounterpartID === args.PlayerID) {
      throw new Error("CounterpartID must be different from PlayerID");
    }

    return await this.call(
      args.PlayerID,
      args.CounterpartID ?? NO_COUNTERPART,
      highlightNotificationSummary(normalizeNotificationText(args.Summary, "Summary")),
      truncateNotificationMessage(normalizeNotificationText(args.Message, "Message")),
    );
  }
}

/**
 * Creates a new instance of the post-notification tool.
 */
export default function createPostNotificationTool() {
  return new PostNotificationTool();
}
