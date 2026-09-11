// The tool server one OpenCode actor talks to.
//
// It is a stdio MCP server, started by OpenCode as the actor's only tool source,
// and it serves the social environment's own verbs. Two things arrive in its
// environment: the actor it answers for, and a turn file the runner rewrites
// before every wake. The turn file names the verbs that are legal right now, so a
// session that reaches for something the moment does not allow is told why rather
// than silently obeyed.
//
// Nothing here applies anything. A verb that is legal is recorded and confirmed,
// and the runtime applies the recorded decision afterwards through its own
// validation path, which is the same two-step the live unified mind already uses:
// generate a proposal, then let the environment decide what it means.

import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openCodeSocialTools } from "./opencode-social-tools.js";

/** What the runner writes before each wake, so the server knows what is legal. */
export interface SocialSeatTurn {
  /** The actor this turn belongs to. */
  actorId: string;
  /** How the actor is named, for the confirmation it reads back. */
  displayName: string;
  /** The verbs legal for this wake. Anything else is refused with a reason. */
  legal: string[];
  /** A label for the moment, used in the log. */
  intentionId?: string;
}

/** One recorded verb call, which is what the runner decodes. */
export interface SocialSeatCall {
  /** The tool the session called. */
  toolName: string;
  /** The arguments it passed. */
  input: Record<string, unknown>;
  /** When it arrived, as an ISO timestamp. */
  at: string;
}

// Read the environment the runner sets. A missing variable is a fatal start,
// because a tool server with no actor would answer for nobody.
function readEnvironment(): { actorId: string; turnFile: string; callsFile: string; game?: string } {
  const actorId = (process.env.SOCIAL_ACTOR ?? "").trim();
  const turnFile = (process.env.SOCIAL_TURN_FILE ?? "").trim();
  const callsFile = (process.env.SOCIAL_CALLS_FILE ?? "").trim();
  if (actorId === "" || turnFile === "" || callsFile === "") {
    process.stderr.write(
      "vox-social seat server cannot start: SOCIAL_ACTOR, SOCIAL_TURN_FILE and SOCIAL_CALLS_FILE are all required.\n"
    );
    process.exit(1);
  }
  const game = (process.env.SOCIAL_GAME ?? "").trim();
  return { actorId, turnFile, callsFile, ...(game === "" ? {} : { game }) };
}

// Read the turn file, or null when the runner has not written one yet.
async function readTurn(file: string): Promise<SocialSeatTurn | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(file, "utf8"));
    if (parsed === null || typeof parsed !== "object") return null;
    const turn = parsed as Partial<SocialSeatTurn>;
    if (typeof turn.actorId !== "string" || !Array.isArray(turn.legal)) return null;
    return {
      actorId: turn.actorId,
      displayName: typeof turn.displayName === "string" ? turn.displayName : turn.actorId,
      legal: turn.legal.filter((name): name is string => typeof name === "string"),
      ...(typeof turn.intentionId === "string" ? { intentionId: turn.intentionId } : {}),
    };
  } catch {
    return null;
  }
}

/** Build the tool server for one actor, ready to connect to a transport. */
export function createSocialSeatServer(actorId: string, turnFile: string, callsFile: string): McpServer {
  const server = new McpServer({ name: "vox-social", version: "1.0.0", title: actorId + " social seat" });
  // One call at a time, so two calls in a turn cannot interleave their writes.
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work, work);
    tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };
  for (const tool of openCodeSocialTools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: z.fromJSONSchema(tool.inputSchema) as z.ZodType<Record<string, unknown>> },
      (args: Record<string, unknown>) =>
        enqueue(async () => {
          const turn = await readTurn(turnFile);
          if (turn === null) {
            return refused(
              "This call cannot be answered: the current turn file at " + turnFile + " is missing or unreadable."
            );
          }
          if (turn.actorId !== actorId) {
            return refused(
              "This call cannot be answered: the current turn belongs to '" + turn.actorId + "' and this server answers for '" + actorId + "'."
            );
          }
          if (!turn.legal.includes(tool.name)) {
            return refused(
              "Refused: " + tool.name + " is not one of the actions open to you right now. Available: " + turn.legal.join(", ") + "."
            );
          }
          const call: SocialSeatCall = { toolName: tool.name, input: args ?? {}, at: new Date().toISOString() };
          await mkdir(path.dirname(callsFile), { recursive: true }).catch(() => undefined);
          await appendFile(callsFile, JSON.stringify(call) + "\n");
          return { content: [{ type: "text" as const, text: confirmed(tool.name, turn) }] };
        })
    );
  }
  return server;
}

// The line a refused call reads back, which is what teaches a session what it can
// reach for on its next attempt.
function refused(reason: string): { content: Array<{ type: "text"; text: string }>; isError: true } {
  return { content: [{ type: "text", text: reason }], isError: true };
}

// The line a recorded call reads back.
function confirmed(toolName: string, turn: SocialSeatTurn): string {
  if (toolName === "social_pass") return "Recorded: you say and do nothing this turn.";
  return "Recorded: " + turn.displayName + "'s " + toolName + " will be applied when this turn is committed.";
}

// Start the server for one actor and connect it over stdio. stdout belongs to the
// protocol, so the one fatal line this file may print goes to stderr.
async function main(): Promise<void> {
  const config = readEnvironment();
  const server = createSocialSeatServer(config.actorId, config.turnFile, config.callsFile);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  process.stderr.write("vox-social seat server cannot start: " + (error instanceof Error ? error.message : String(error)) + "\n");
  process.exit(1);
});

