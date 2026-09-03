/**
 * Tool for reading the world channel feed.
 * Returns recent global messages ordered by append ID (newest first).
 */

import { ToolBase } from "../base.js";
import * as z from "zod";
import { knowledgeManager } from "../../server.js";

/**
 * Input schema for the get-global-messages tool.
 */
const GetGlobalMessagesInputSchema = z.object({
  Limit: z.number().int().min(1).max(200).optional().default(50).describe("Maximum messages to return"),
  BeforeID: z.number().int().optional().describe("Return messages with ID lower than this (paging)"),
});

/**
 * Output schema: a page of world-channel messages.
 */
const GetGlobalMessagesOutputSchema = z.object({
  messages: z.array(z.object({
    ID: z.number(),
    Turn: z.number(),
    SpeakerID: z.number(),
    SpeakerRole: z.string().nullable(),
    Content: z.string(),
    ReplyToID: z.number().nullable(),
    CreatedAt: z.number(),
  })).default([]),
});

/**
 * Tool that reads recent public messages from the durable world channel.
 */
class GetGlobalMessagesTool extends ToolBase {
  readonly name = "get-global-messages";

  readonly description = "Read recent messages from the world channel (public broadcasts by any civilization or the observer).";

  readonly inputSchema = GetGlobalMessagesInputSchema;

  readonly outputSchema = GetGlobalMessagesOutputSchema;

  readonly annotations = { readOnlyHint: true };

  async execute(args: z.infer<typeof this.inputSchema>): Promise<z.infer<typeof this.outputSchema>> {
    const db = knowledgeManager.getStore().getDatabase();
    let query = db
      .selectFrom("GlobalMessages")
      .selectAll()
      .orderBy("ID", "desc")
      .limit(args.Limit ?? 50);
    if (args.BeforeID !== undefined) {
      query = query.where("ID", "<", args.BeforeID);
    }
    const rows = await query.execute();
    return {
      messages: rows.map((row) => ({
        ID: row.ID,
        Turn: row.Turn,
        SpeakerID: row.SpeakerID,
        SpeakerRole: row.SpeakerRole ?? null,
        Content: row.Content,
        ReplyToID: row.ReplyToID ?? null,
        CreatedAt: row.CreatedAt,
      })),
    };
  }
}

export default function createGetGlobalMessagesTool() {
  return new GetGlobalMessagesTool();
}

