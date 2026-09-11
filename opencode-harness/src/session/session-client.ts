// Talks to one OpenCode server on behalf of the seats.
// One session is created per seat and kept for the whole game, because the
// point of the harness is that a seat's identity, history and provider cache
// survive from turn to turn. A fresh session per turn would throw all of that
// away, so the client never does it.

import { authHeaders, type RunningServer } from "./opencode-server.js";
import type { SeatModel, SeatTurnResult, SessionToolCall, SessionUsage } from "./types.js";
import { logger } from "../utils/logger.js";

// How long one observation may take before the call is abandoned, in
// milliseconds. A seat thinking for a long time is normal, but never forever.
//
// This is deliberately shorter than the five hundred milliseconds times six
// hundred that undici allows a response to take before it gives up on its own.
// When undici gives up first, the harness cannot tell a slow model from a lost
// connection, and the request it abandoned keeps occupying the session. A
// shorter deadline of our own means the harness notices first and can clear the
// work it started.
const defaultTurnTimeoutMs = 150000;

// A part of a model response, as the server sends it. Only the fields the
// harness reads are named; the rest is kept as raw text.
interface RawPart {
  type?: unknown;
  text?: unknown;
  tool?: unknown;
  callID?: unknown;
  state?: unknown;
  status?: unknown;
  input?: unknown;
  output?: unknown;
  error?: unknown;
}

// One message as the server returns it.
interface RawMessage {
  info?: { tokens?: unknown; cost?: unknown; modelID?: unknown; providerID?: unknown; role?: unknown };
  parts?: unknown;
}

// Read a number, defaulting to zero when the field is missing.
function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// Read the token and spend numbers out of one message.
function readUsage(raw: RawMessage["info"]): SessionUsage {
  const tokens = (raw?.tokens ?? {}) as Record<string, unknown>;
  const cache = (tokens.cache ?? {}) as Record<string, unknown>;
  const input = number(tokens.input);
  const output = number(tokens.output);
  const reasoning = number(tokens.reasoning);
  const cacheRead = number(cache.read);
  const cacheWrite = number(cache.write);
  const reported = tokens.total;
  return {
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    total: typeof reported === "number" && Number.isFinite(reported) ? reported : input + output + reasoning,
    cost: typeof raw?.cost === "number" ? raw.cost : null
  };
}

// Add one message's usage onto a running total.
//
// A turn is several API calls when the model uses tools, and each call reports
// its own tokens and cost. The turn's cost is their sum, so the numbers a run
// reports match what the provider will bill.
function addUsage(total: SessionUsage, part: SessionUsage): SessionUsage {
  return {
    input: total.input + part.input,
    output: total.output + part.output,
    reasoning: total.reasoning + part.reasoning,
    cacheRead: total.cacheRead + part.cacheRead,
    cacheWrite: total.cacheWrite + part.cacheWrite,
    total: total.total + part.total,
    cost: total.cost === null && part.cost === null ? null : (total.cost ?? 0) + (part.cost ?? 0)
  };
}

// The usage of a turn that produced nothing at all.
function zeroUsage(): SessionUsage {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: null };
}

// Read one tool call out of a response part. The server wraps the payload in a
// state object, so the arguments and the result are read from there first and
// from the part itself second.
function readToolCall(part: RawPart): SessionToolCall {
  const state = (part.state ?? {}) as Record<string, unknown>;
  const output = state.output ?? part.output;
  return {
    tool: typeof part.tool === "string" ? part.tool : "unknown-tool",
    callID: typeof part.callID === "string" ? part.callID : null,
    status: typeof state.status === "string" ? state.status : typeof part.status === "string" ? part.status : null,
    input: state.input ?? part.input ?? null,
    output: typeof output === "string" ? output : output === undefined || output === null ? null : JSON.stringify(output),
    error: typeof state.error === "string" ? state.error : typeof part.error === "string" ? part.error : null
  };
}

// Turn a whole turn's messages into the shape the trace store keeps.
//
// It takes every assistant message the turn produced, not just the last one,
// because a turn that uses tools is several messages: the model calls a tool,
// reads the result, and calls again. The final message usually carries only the
// closing text, so reading that alone would report a turn in which the model
// did nothing.
export function readTurnResult(
  session: string,
  model: string,
  messages: RawMessage[],
  latencyMs: number
): SeatTurnResult {
  const reasoning: string[] = [];
  const text: string[] = [];
  const toolCalls: SessionToolCall[] = [];
  const unknownParts: string[] = [];
  let usage = zeroUsage();
  for (const message of messages) {
    usage = addUsage(usage, readUsage(message.info));
    const parts = Array.isArray(message.parts) ? (message.parts as RawPart[]) : [];
    for (const part of parts) {
      const type = typeof part.type === "string" ? part.type : "unknown";
      if (type === "reasoning") {
        if (typeof part.text === "string") reasoning.push(part.text);
      } else if (type === "text") {
        if (typeof part.text === "string") text.push(part.text);
      } else if (type === "tool") {
        toolCalls.push(readToolCall(part));
      } else if (type !== "step-start" && type !== "step-finish" && type !== "snapshot") {
        unknownParts.push(type);
      }
    }
  }
  return {
    session,
    model,
    reasoning: reasoning.length > 0 ? reasoning.join("\n\n") : null,
    modelText: text.length > 0 ? text.join("\n\n") : null,
    toolCalls,
    usage,
    latencyMs,
    unknownParts
  };
}

// One client per run, holding one session per seat.
export class SessionClient {
  // The server this client talks to.
  private readonly server: RunningServer;

  // The seat model settings, which may differ per seat.
  private readonly models: Map<string, SeatModel>;

  // Sessions created so far, keyed by seat, so a seat keeps one session.
  private readonly sessions = new Map<string, string>();

  // Build a client for a running server. The default model is used for any seat
  // the caller does not override.
  // A deadline may be given for one turn, which a run shortens when it wants to
  // fail a seat quickly rather than wait out a stalled model call.
  constructor(
    server: RunningServer,
    defaultModel: SeatModel,
    overrides: Record<string, SeatModel> = {},
    options: { turnTimeoutMs?: number } = {}
  ) {
    this.server = server;
    this.models = new Map(Object.entries(overrides));
    this.defaultModel = defaultModel;
    this.turnTimeoutMs = options.turnTimeoutMs ?? defaultTurnTimeoutMs;
  }

  // The model used by seats without an override.
  private readonly defaultModel: SeatModel;

  // How long one turn may take before the harness gives up on it.
  private readonly turnTimeoutMs: number;

  // The session already held for a seat, if there is one.
  sessionOf(seat: string): string | null {
    return this.sessions.get(seat) ?? null;
  }

  // The model a seat runs on.
  modelOf(seat: string): SeatModel {
    return this.models.get(seat) ?? this.defaultModel;
  }

  // Create the session a seat will keep for the rest of the game. Calling this
  // twice for one seat is a mistake, so the second call is refused rather than
  // quietly abandoning the first session and its cache.
  async openSeat(seat: string, title?: string): Promise<string> {
    if (this.sessions.has(seat)) {
      throw new Error("Seat '" + seat + "' already has a session; a seat keeps one session for the whole game");
    }
    const created = await this.request<{ id?: unknown }>("POST", "/session", {
      title: title ?? "seat " + seat
    });
    if (typeof created.id !== "string") {
      throw new Error("The server did not return a session id for seat '" + seat + "'");
    }
    this.sessions.set(seat, created.id);
    logger.debug("Opened session " + created.id + " for seat " + seat);
    return created.id;
  }

  // Send one observation to a seat and read back what it did. The seat must
  // already have a session, so that persistence is never an accident.
  async sendObservation(seat: string, observation: string): Promise<SeatTurnResult> {
    const session = this.sessions.get(seat);
    if (!session) {
      throw new Error("Seat '" + seat + "' has no session; open one before sending an observation");
    }
    const model = this.modelOf(seat);
    // Count the messages first, so everything the turn adds can be collected
    // afterwards. A turn that uses tools is several messages, and the reply to
    // the request carries only the closing one.
    const before = (await this.request<RawMessage[]>("GET", "/session/" + session + "/message")).length;
    const started = Date.now();
    await this.request<RawMessage>("POST", "/session/" + session + "/message", {
      providerID: model.providerID,
      modelID: model.modelID,
      parts: [{ type: "text", text: observation }]
    });
    const latencyMs = Date.now() - started;
    const all = await this.request<RawMessage[]>("GET", "/session/" + session + "/message");
    const produced = all.slice(before).filter((message) => message.info?.role === "assistant");
    const result = readTurnResult(session, model.providerID + "/" + model.modelID, produced, latencyMs);
    logger.debug(
      "Seat " + seat + " answered in " + latencyMs + "ms with " + result.toolCalls.length + " tool call(s)"
    );
    return result;
  }

  // The messages a session holds, which is how a run proves that history
  // accumulated rather than being rebuilt each turn.
  async listMessages(seat: string): Promise<unknown[]> {
    const session = this.sessions.get(seat);
    if (!session) {
      throw new Error("Seat '" + seat + "' has no session");
    }
    const messages = await this.request<unknown[]>("GET", "/session/" + session + "/message");
    return Array.isArray(messages) ? messages : [];
  }

  // One authenticated call against the server, with a timeout so a lost
  // server cannot hang a run forever.
  private async request<T>(method: string, route: string, body?: unknown, timeoutMs?: number): Promise<T> {
    const controller = new AbortController();
    const budget = timeoutMs ?? this.turnTimeoutMs;
    const timer = setTimeout(() => controller.abort(), budget);
    try {
      const response = await fetch(this.server.url + route, {
        method,
        headers: { ...authHeaders(this.server.credentials), "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(method + " " + route + " failed with HTTP " + response.status + ": " + detail.slice(0, 300));
      }
      return (await response.json()) as T;
    } catch (error) {
      // Turn an expired deadline into a message that says so. Otherwise it
      // reaches a run as an unexplained transport failure, which is the shape
      // that a stalled model call and a dead socket share.
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("the turn exceeded " + budget + "ms and was abandoned");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  // Clear whatever work a seat's session is still running.
  //
  // A stalled model call keeps occupying its session, and because the server
  // runs one thing at a time per session, every later request queues behind it
  // and times out too. Aborting is what breaks that cycle, and it keeps the
  // session and its prompt cache rather than throwing the seat's history away.
  async abort(seat: string): Promise<void> {
    const session = this.sessions.get(seat);
    if (!session) {
      throw new Error("Seat '" + seat + "' has no session to abort");
    }
    await this.request<unknown>("POST", "/session/" + session + "/abort", {}, 30000);
    logger.warn("Abandoned the stalled work in seat " + seat + "'s session " + session);
  }
}
