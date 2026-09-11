// An OpenCode session as the mind of one actor in the social environment.
//
// The environment already abstracts the thing that thinks behind one interface,
// and this is another implementation of it. The scheduler, the store, the event
// stream and the interface all stay as they are: a wake arrives as a context
// bundle, one authoritative decision goes back.
//
// Two properties are the reason for doing it this way. The session persists for
// the whole game, so an actor keeps its own history and the provider keeps its
// prompt cache warm. And the session is confined to the environment's own verbs,
// so a model cannot reach anything the environment did not offer it.
//
// The runner never applies anything. It records the proposal it was given and the
// runtime validates and applies it, which is the same split the live unified mind
// uses and the reason a refusal is a durable outcome rather than a lost turn.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { z } from "zod";
import path from "node:path";
import { homedir } from "node:os";
import type { ModelMessage } from "ai";
// The harness is reached lazily rather than imported at the top of this file.
//
// This runner is only used when a session asks to think with OpenCode, and the
// harness is a separate workspace whose built output is not in the repository. A
// top-level import would make every test run and every build depend on that
// output existing; a lazy one means nothing is loaded until a session actually
// wants an OpenCode mind.
import type { OpenCodeServer } from "opencode-harness/session/opencode-server.js";
import type { SessionClient } from "opencode-harness/session/session-client.js";
import type { SeatConfigOptions } from "opencode-harness/run/seat-config.js";
import { socialSeatIdentity } from "./opencode-seat-identity.js";
import type { SocialActor, SocialDecision } from "../types.js";
import type { SocialContextBundle } from "../context/social-context-builder.js";
import type { SocialDecisionRun, SocialModelExecutor } from "./social-model-executor.js";
import { decodeSocialDecision } from "./social-decision-tools.js";
import { openCodeSocialTools } from "./opencode-social-tools.js";
import type { SocialSeatCall, SocialSeatTurn } from "./opencode-social-seat.js";
import type { SeatToolSpec } from "./opencode-social-seat.js";
import { createLogger } from "../../utils/logger.js";

/** Everything the runner needs to start. */
export interface OpenCodeMindRunnerOptions {
  /** The label the sessions belong to, used in the working directory path. */
  runId: string;
  /** The built entry point of the social seat tool server. */
  serverEntry: string;
  /** The provider and model every actor runs on unless one overrides it. */
  providerID: string;
  modelID: string;
  /** The agent every turn names, which is what confines the session. */
  agent?: string;
  /** The identity every actor is given as its standing context. */
  identity?: string;
  /** How long one actor may think before the runner gives up on the wake. */
  turnTimeoutMs?: number;
  /** The port the OpenCode server binds, so a caller can avoid a collision. */
  port?: number;
}

// The agent name a social actor's turns run under, which its configuration defines.
const socialAgent = "social-seat";

// The type of the pieces this runner borrows from the harness.
interface HarnessModules {
  // Start and stop one OpenCode server.
  OpenCodeServer: typeof OpenCodeServer;
  // Hold one persistent session and read a whole turn back from it.
  SessionClient: typeof SessionClient;
  // Write one seat's confined configuration.
  writeSeatConfig: (options: SeatConfigOptions) => Promise<string>;
  // Where a seat's workspace lives, which must be outside every repository.
  seatWorkspaceDirectory: (runId: string, seat: string) => string;
}

// Load the harness pieces on first use, once per process.
let harnessModules: Promise<HarnessModules> | null = null;
function loadHarness(): Promise<HarnessModules> {
  if (harnessModules) return harnessModules;
  harnessModules = (async (): Promise<HarnessModules> => {
    const [server, client, config, workspace] = await Promise.all([
      import("opencode-harness/session/opencode-server.js"),
      import("opencode-harness/session/session-client.js"),
      import("opencode-harness/run/seat-config.js"),
      import("opencode-harness/session/seat-workspace.js"),
    ]);
    return {
      OpenCodeServer: server.OpenCodeServer,
      SessionClient: client.SessionClient,
      writeSeatConfig: config.writeSeatConfig,
      seatWorkspaceDirectory: workspace.seatWorkspaceDirectory,
    };
  })();
  return harnessModules;
}

/** How one actor is reached and what it has already been told. */
interface ActorSession {
  /** The session, which lives for the whole run. */
  client: SessionClient;
  /** How many of the context messages this session has already been sent. */
  sentMessages: number;
}

// Render one conversation message as the text an actor reads. The environment
// builds messages for the AI SDK, so the shape varies; this keeps the words and
// drops the structure, because a session keeps its own history.
function renderMessage(message: ModelMessage): string {
  const role = typeof message.role === "string" ? message.role : "unknown";
  const content = (message as { content?: unknown }).content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((part) => (part !== null && typeof part === "object" && "text" in part ? String((part as { text?: unknown }).text ?? "") : ""))
            .filter((piece) => piece !== "")
            .join("\n")
        : "";
  if (text.trim() === "") return "";
  return role === "assistant" ? "You said: " + text : text;
}

/** Drive every model actor through one persistent OpenCode session each. */
export class OpenCodeMindRunner implements SocialModelExecutor {
  private readonly logger = createLogger("opencode-mind-runner");
  private readonly sessions = new Map<string, ActorSession>();
  private readonly servers = new Map<string, OpenCodeServer>();

  public constructor(private readonly options: OpenCodeMindRunnerOptions) {}

  /** Generate one side-effect-free decision, which is what the scheduler calls. */
  public async decide(actor: SocialActor, context: SocialContextBundle, actorNames: string[], abortSignal?: AbortSignal): Promise<SocialDecision> {
    return (await this.decideWithTelemetry(actor, context, actorNames, abortSignal)).decision;
  }

  /** Generate one decision and return the usage the same way the sandbox path does. */
  public async decideWithTelemetry(actor: SocialActor, context: SocialContextBundle, _actorNames: string[], abortSignal?: AbortSignal): Promise<SocialDecisionRun> {
    const startedAt = Date.now();
    const session = await this.sessionFor(actor, context);
    const legal = Object.keys(context.decisionTools ?? {});
    if (legal.length === 0) throw new Error("no decision tool is legal for " + actor.id + " this turn");
    const turnFile = this.turnFileFor(actor.id);
    const callsFile = this.callsFileFor(actor.id);
    const turn: SocialSeatTurn = { actorId: actor.id, displayName: actor.displayName, legal, ...(context.intentionId ? { intentionId: context.intentionId } : {}) };
    // A support read is free, so it is legal without being the turn's action.
    const outwardNames = (context.decisionToolDefinitions ?? [])
      .filter((definition) => definition.phase !== "support")
      .map((definition) => definition.name)
      .concat(openCodeSocialTools.map((tool) => tool.name).filter((name) => legal.includes(name)));
    await mkdir(path.dirname(turnFile), { recursive: true });
    await writeFile(turnFile, JSON.stringify(turn, null, 2), "utf8");
    await rm(callsFile, { force: true });
    const observation = this.observation(actor, context, session.sentMessages);
    const result = await session.client.sendObservation(actor.id, observation);
    session.sentMessages = context.messages.length;
    if (abortSignal?.aborted) throw new Error("the wake was abandoned before a decision arrived");
    const calls = await this.readCalls(actor.id, callsFile);
    // A support read is not a decision, so only an outward verb counts as the
    // turn's one action. The environment's own verbs are outward too, which is
    // how a seat acts in the game rather than only speaking.
    const outward = calls.filter((call) => outwardNames.includes(call.toolName));
    if (outward.length === 0) {
      // A wake that reached for nothing is a pass: the environment treats silence
      // as a decision, and the model was offered that verb.
      return { decision: { kind: "pass", reasonCode: "no-outward-call" }, retryCount: 0, semanticRetryCount: 0, providerAttemptCount: 1, providerRetryCount: 0, latencyMs: Date.now() - startedAt, ...(result.usage ? { usage: usageOf(result.usage) } : {}) };
    }
    const decision = decodeSocialDecision([{ toolName: outward[0].toolName, input: outward[0].input }], context.decisionToolDefinitions ?? []);
    return { decision, retryCount: 0, semanticRetryCount: 0, providerAttemptCount: 1, providerRetryCount: 0, latencyMs: Date.now() - startedAt, ...(result.usage ? { usage: usageOf(result.usage) } : {}) };
  }

  /** Stop every session and the server behind them. */
  public async close(): Promise<void> {
    this.sessions.clear();
    const servers = [...this.servers.values()];
    this.servers.clear();
    for (const server of servers) {
      await server.stop().catch((error: unknown) => this.logger.warn("Could not stop an OpenCode server", { error }));
    }
  }

  // The observation for this wake: the situation the environment built, plus only
  // the conversation this session has not already been given.
  // The verbs a session is offered: the environment's own, plus the social set.
  //
  // A definition carries a Zod schema, because that is what the environment
  // speaks; a tool server speaks JSON Schema, so it is converted here rather than
  // asking every environment to describe its verbs twice.
  private toolSpecs(context: SocialContextBundle): SeatToolSpec[] {
    const specs: SeatToolSpec[] = openCodeSocialTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }));
    for (const definition of context.decisionToolDefinitions ?? []) {
      if (specs.some((spec) => spec.name === definition.name)) continue;
      let inputSchema: Record<string, unknown>;
      try {
        const converted = z.toJSONSchema(definition.inputSchema) as Record<string, unknown>;
        delete converted.$schema;
        inputSchema = converted;
      } catch {
        // A schema this conversion cannot express is offered with no arguments
        // rather than dropped, so a session still knows the verb exists.
        inputSchema = { type: "object", properties: {} };
      }
      specs.push({ name: definition.name, description: definition.description, inputSchema });
    }
    return specs;
  }

  private observation(actor: SocialActor, context: SocialContextBundle, alreadySent: number): string {
    const lines: string[] = [];
    if (context.environment) lines.push("The situation as you know it:", context.environment, "");
    const fresh = context.messages.slice(Math.min(alreadySent, context.messages.length));
    const rendered = fresh.map(renderMessage).filter((piece) => piece !== "");
    if (rendered.length > 0) lines.push("Since your last opportunity to speak:", ...rendered, "");
    lines.push("Choose exactly one action open to you, using one tool call and no prose.");
    return lines.join("\n");
  }

  // The session for one actor, opened on first use and kept for the run.
  private async sessionFor(actor: SocialActor, context: SocialContextBundle): Promise<ActorSession> {
    const held = this.sessions.get(actor.id);
    if (held) return held;
    const harness = await loadHarness();
    // The session's tool list is fixed when its server starts, so it is the union
    // of what this environment can ever offer: the social verbs plus whatever the
    // environment defines. Which of them is legal right now is the turn file's
    // business, and an illegal one is refused with a reason rather than obeyed.
    const toolsFile = this.toolsFileFor(actor.id);
    await mkdir(path.dirname(toolsFile), { recursive: true });
    await writeFile(toolsFile, JSON.stringify(this.toolSpecs(context), null, 2), "utf8");
    // A session reads the configuration of the directory its server was started
    // in, so one server for the whole table would read one actor's configuration
    // and serve it to everyone. Each actor therefore gets its own server in its
    // own workspace, which is also what keeps two actors from sharing a session.
    const seatDirectory = harness.seatWorkspaceDirectory(this.options.runId, actor.id);
    await harness.writeSeatConfig({
      seat: actor.id,
      playerID: null,
      model: { providerID: this.options.providerID, modelID: this.options.modelID },
      seatDirectory,
      corpusDirectory: "",
      socialDirectory: this.socialDirectoryFor(actor.id),
      serverEntry: this.options.serverEntry,
      identity: this.options.identity ?? socialSeatIdentity,
      // The environment's own verbs are this seat's whole tool surface, so the
      // tool server is registered under a name of its own and the game's four
      // tools are not switched on.
      mcpServerName: "vox-social",
      mcpEnvironment: {
        SOCIAL_ACTOR: actor.id,
        SOCIAL_TURN_FILE: this.turnFileFor(actor.id),
        SOCIAL_CALLS_FILE: this.callsFileFor(actor.id),
        SOCIAL_TOOLS_FILE: toolsFile,
        SOCIAL_GAME: this.options.runId,
      },
      // Every verb the server offers is switched on, because the turn file is
      // what decides which of them is legal right now.
      agentTools: Object.fromEntries(this.toolSpecs(context).map((spec) => ["vox-social_" + spec.name, true])),
      // The agent the configuration defines has to carry the same name the turns
      // send, or the session finds no agent and answers with an error instead of
      // a decision.
      agentName: this.options.agent ?? socialAgent,
    });
    const server = await this.startServerFor(actor.id, seatDirectory);
    const client = new harness.SessionClient(server.address(), { providerID: this.options.providerID, modelID: this.options.modelID }, {}, { turnTimeoutMs: this.options.turnTimeoutMs, agent: this.options.agent ?? socialAgent });
    await client.openSeat(actor.id, "social seat " + actor.displayName);
    const session: ActorSession = { client, sentMessages: 0 };
    this.sessions.set(actor.id, session);
    this.logger.info("Opened a social session for " + actor.id);
    return session;
  }

  // Start the server one actor talks through, in that actor's own workspace.
  //
  // The port is offset by the actor's position so a table of four gets four ports
  // rather than four servers fighting over one.
  private async startServerFor(actorId: string, seatDirectory: string): Promise<OpenCodeServer> {
    const held = this.servers.get(actorId);
    if (held) return held;
    const harness = await loadHarness();
    const server = new harness.OpenCodeServer(seatDirectory);
    const index = this.servers.size;
    await server.start({ port: (this.options.port ?? 7300) + index });
    this.servers.set(actorId, server);
    return server;
  }

  // The recorded calls for this wake, read back as the runner's own record of
  // what the session reached for.
  private async readCalls(actorId: string, callsFile: string): Promise<SocialSeatCall[]> {
    try {
      const text = await readFile(callsFile, "utf8");
      return text
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as SocialSeatCall);
    } catch (error) {
      this.logger.warn("No recorded call was found for " + actorId, { error });
      return [];
    }
  }

  private turnFileFor(actorId: string): string { return path.join(this.seatRoot(), actorId, "turn.json"); }
  private toolsFileFor(actorId: string): string { return path.join(this.seatRoot(), actorId, "tools.json"); }
  private callsFileFor(actorId: string): string { return path.join(this.seatRoot(), actorId, "calls.jsonl"); }
  private socialDirectoryFor(actorId: string): string { return path.join(this.seatRoot(), actorId); }
  // The state a run keeps for its seats, beside the workspaces rather than inside
  // one, because a turn file is the runner's record and not a seat's instruction.
  private seatRoot(): string {
    // The state a run keeps for its seats sits beside the workspaces rather than
    // inside one, because a turn file is the runner's record and not a seat's
    // instruction. The anchor seat is never created; only its path is used.
    return path.join(path.dirname(path.join(this.workspaceRoot(), this.options.runId, "anchor")), "state");
  }

  // Where the harness puts seat workspaces, read from its own directory helper by
  // asking for one and taking its parent.
  private workspaceRoot(): string {
    // A constant path rather than a call, so it can be used before the harness is
    // loaded. The harness module is the authority for it and the test for the
    // workspace helper holds the two in agreement.
    return path.join(homedir(), ".vox-deorum", "harness-seats");
  }
}

// Map the harness usage shape onto the environment's, so a diagnostic panel sees
// the same fields whichever executor produced the decision.
function usageOf(usage: { input: number; output: number; reasoning: number; cacheRead: number; total: number; cost: number | null }): SocialDecisionRun["usage"] {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    reasoningTokens: usage.reasoning,
    cachedTokens: usage.cacheRead,
    totalTokens: usage.total,
    ...(usage.cost === null ? {} : { cost: usage.cost }),
  };
}
