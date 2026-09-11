// The game's own deal system, reached through its MCP tools.
//
// A simulated run settles deals in the harness's own social log, which is enough
// to see whether seats want to trade. A live run should not: the game already has
// a deal system with real trade items, live legality checks and a transactional
// enactment, and a private log beside it would be a second, weaker truth about
// the same thing.
//
// The sequence is three calls. A proposal is an appended transcript message
// carrying a deal payload, which returns the message id that both sides use to
// find it. Acceptance is an enactment against that id, which transfers the items
// and applies the promises in one game action. Rejection answers the same id.

import type { VoxConnector } from "./vox-connector.js";
import type { DealOperation, DecisionOutcome } from "../types.js";
import { logger } from "../../utils/logger.js";

// How long a promised payment runs, when a seat does not say.
const defaultDurationTurns = 10;

// How many transcript rows to scan in one peer conversation. This bounds a read
// rather than a history: a deal thread is short, and what a seat needs to know
// is the offers still waiting on it and what became of its own.
const transcriptScanRows = 300;

// The message types that close a proposal, whether it was enacted or refused.
const answerTypes = ["deal-accept", "deal-reject", "deal-enacted"];

// One trade item, in the shape the game's schema expects.
interface TradeItem {
  // Who gives.
  fromPlayerID: number;
  // Who receives.
  toPlayerID: number;
  // The kind of item, as the game names it.
  itemType: string;
  // How much of it, for gold and per-turn gold.
  amount?: number;
  // How long it lasts, for a per-turn item.
  duration?: number;
  // Which resource, for a resource item.
  resourceID?: string;
}

// The payload a proposal message carries.
interface DealPayload {
  // The schema version the game expects.
  version: 1;
  // What is being traded.
  items: TradeItem[];
  // What is being promised, which this harness does not yet express.
  promises: unknown[];
  // What the proposer said.
  rationale?: string;
}

// Build the payload a proposal carries for one operation.
//
// Only the terms the harness can express honestly are translated. Anything else
// is refused rather than sent as a malformed deal the game would reject, because
// a refusal a seat can read beats a failure it cannot.
export function dealPayloadFor(
  operation: DealOperation,
  fromPlayerID: number,
  toPlayerID: number
): { payload: DealPayload } | { refused: string } {
  const items: TradeItem[] = [];
  if (typeof operation.gold === "number") {
    if (!Number.isInteger(operation.gold) || operation.gold <= 0) {
      return { refused: "gold must be a positive whole number" };
    }
    items.push({ fromPlayerID, toPlayerID, itemType: "GOLD", amount: operation.gold });
  }
  if (typeof operation.goldPerTurn === "number") {
    if (!Number.isInteger(operation.goldPerTurn) || operation.goldPerTurn <= 0) {
      return { refused: "gold per turn must be a positive whole number" };
    }
    items.push({
      fromPlayerID,
      toPlayerID,
      itemType: "GOLD_PER_TURN",
      amount: operation.goldPerTurn,
      duration: operation.duration ?? defaultDurationTurns
    });
  }
  if (typeof operation.resource === "string" && operation.resource.length > 0) {
    // A resource is named in the game by an identifier rather than by the word a
    // seat writes, and this harness has no way to look one up without a game, so
    // a resource term is refused rather than guessed at.
    return { refused: "a resource term needs the game's own resource identifier, which this run cannot resolve" };
  }
  if (items.length === 0) return { refused: "an offer needs at least one term, such as gold or gold per turn" };
  return {
    payload: {
      version: 1,
      items,
      promises: [],
      ...(typeof operation.message === "string" && operation.message.length > 0
        ? { rationale: operation.message.slice(0, 500) }
        : {})
    }
  };
}

// Settles deals in a live game.
export class LiveDeals {
  // The connection to the game.
  private readonly connector: VoxConnector;

  // The player index of the seat acting, keyed by seat name.
  private readonly players: Record<string, number>;

  // The seat each player index belongs to, so a transcript row can be read back
  // with the names the seats know each other by.
  private readonly seatByID: Record<number, string> = {};

  // Build a deal gateway for one game.
  constructor(connector: VoxConnector, players: Record<string, number>) {
    this.connector = connector;
    this.players = players;
    for (const [seat, id] of Object.entries(players)) this.seatByID[id] = seat;
  }

  // Carry out one deal operation against the game.
  async apply(seat: string, operation: DealOperation): Promise<DecisionOutcome> {
    const from = this.players[seat];
    if (from === undefined) {
      return { type: operation.kind, taken: false, reason: "this seat has no player index in the game" };
    }
    if (operation.kind === "deal-propose") return this.propose(seat, from, operation);
    if (operation.kind === "deal-accept") return this.accept(seat, from, operation);
    return this.reject(seat, from, operation);
  }

  // Offer terms, by appending the proposal the game records.
  private async propose(seat: string, from: number, operation: DealOperation): Promise<DecisionOutcome> {
    const to = operation.to ? this.players[operation.to] : undefined;
    if (to === undefined) {
      return {
        type: operation.kind,
        taken: false,
        reason: "no offer was sent, because the seat it was aimed at has no player index in the game"
      };
    }
    const built = dealPayloadFor(operation, from, to);
    if ("refused" in built) return { type: operation.kind, taken: false, reason: built.refused };
    const result = await this.connector.call("append-message", {
      PlayerAID: from,
      PlayerBID: to,
      SpeakerID: from,
      MessageType: "deal-proposal",
      Content: operation.message ?? "",
      Payload: { Deal: built.payload }
    });
    if (result.isError) return { type: operation.kind, taken: false, reason: result.text.slice(0, 200) };
    // The proposal's own id is what both sides use to find it again, so it is
    // reported back to the seat rather than swallowed.
    const id = readProposalID(result.text);
    logger.info("Seat " + seat + " offered a deal" + (id ? " as proposal " + id : ""));
    return {
      type: operation.kind,
      taken: true,
      ...(id ? { reason: "recorded as proposal " + id } : {})
    };
  }

  // Accept an offer, which enacts it as one game action.
  private async accept(seat: string, from: number, operation: DealOperation): Promise<DecisionOutcome> {
    const proposal = readProposalID(operation.deal ?? "");
    if (!proposal) return { type: operation.kind, taken: false, reason: "accepting needs the proposal id" };
    const result = await this.connector.call("enact-agent-deal", {
      ProposalMessageID: Number(proposal),
      AccepterID: from,
      Content: operation.message ?? ""
    });
    if (result.isError) return { type: operation.kind, taken: false, reason: result.text.slice(0, 200) };
    // The game answers successfully with a refusal inside the payload, so a
    // refusal is read from the body rather than from the call's error flag.
    const refusal = readRefusal(result.text);
    if (refusal) return { type: operation.kind, taken: false, reason: refusal };
    logger.info("Seat " + seat + " accepted proposal " + proposal + ", and the game enacted it");
    return { type: operation.kind, taken: true };
  }

  // Refuse an offer.
  private async reject(seat: string, from: number, operation: DealOperation): Promise<DecisionOutcome> {
    const proposal = readProposalID(operation.deal ?? "");
    if (!proposal) return { type: operation.kind, taken: false, reason: "refusing needs the proposal id" };
    const result = await this.connector.call("reject-agent-deal", {
      PlayerAID: from,
      PlayerBID: from,
      ProposalMessageID: Number(proposal),
      SpeakerID: from,
      Content: operation.message ?? ""
    });
    if (result.isError) return { type: operation.kind, taken: false, reason: result.text.slice(0, 200) };
    const refusal = readRefusal(result.text);
    if (refusal) return { type: operation.kind, taken: false, reason: refusal };
    logger.info("Seat " + seat + " refused proposal " + proposal);
    return { type: operation.kind, taken: true };
  }

  // What this seat should know about deals, read back from the game's transcript.
  //
  // The transcript is the game's own pair conversation, so an offer another seat
  // made is read here rather than remembered by the harness, and a seat which
  // joined the game late still sees what is on the table. Two things earn a
  // line: an offer waiting on this seat, and what became of an offer it made. A
  // conversation that cannot be read is left out rather than guessed at.
  async thread(seat: string): Promise<string[]> {
    const from = this.players[seat];
    if (from === undefined) return [];
    const lines: string[] = [];
    for (const [peer, peerID] of Object.entries(this.players)) {
      if (peer === seat) continue;
      const result = await this.connector.call("read-transcript", {
        PlayerAID: from,
        PlayerBID: peerID,
        Limit: transcriptScanRows
      });
      if (result.isError) {
        logger.warn("Reading the deal transcript with " + peer + " failed: " + result.text.slice(0, 160));
        continue;
      }
      const rows = readTranscript(result.text);
      // A proposal is closed once either side has answered it, so the answers are
      // gathered first and every offer is judged against them. This is also what
      // makes a proposal the game already enacted read as settled rather than as
      // still waiting for an answer.
      const answered = new Map<number, string>();
      for (const row of rows) {
        if (!answerTypes.includes(row.messageType)) continue;
        const answeredID = row.payload.ProposalMessageID;
        if (typeof answeredID === "number") answered.set(answeredID, row.messageType);
      }
      for (const row of rows) {
        if (row.messageType !== "deal-proposal") continue;
        const answer = answered.get(row.id);
        const terms = readTerms(row.payload, (id) => this.seatByID[id] ?? "seat " + id);
        if (row.speakerID !== from && answer === undefined) {
          lines.push(
            "[turn " + row.turn + "] " + peer + " offers offer " + row.id + ": " + terms + " (answer with deal-accept or deal-reject naming " + row.id + ")"
          );
        } else if (row.speakerID === from && answer === undefined) {
          lines.push("Your offer " + row.id + " to " + peer + " is still open: " + terms);
        } else if (row.speakerID === from) {
          lines.push("Your offer " + row.id + " to " + peer + " was " + answer + ": " + terms);
        }
      }
    }
    return lines;
  }
}

// One transcript row, as far as a deal reader needs to understand it.
interface TranscriptRow {
  // The append id both sides quote when they answer this row.
  id: number;
  // The player who wrote it.
  speakerID: number;
  // What kind of message it is, in the game's vocabulary.
  messageType: string;
  // The row's payload, which carries the deal terms or the answer's target.
  payload: Record<string, unknown>;
  // The game turn it was written on.
  turn: number;
}

// Read the rows out of a transcript read, keeping only the fields a deal reader
// uses. Anything malformed is dropped rather than guessed at.
export function readTranscript(text: string): TranscriptRow[] {
  const parsed = parseJson(text);
  if (parsed === null) return [];
  const rows = Array.isArray(parsed) ? parsed : (parsed as { messages?: unknown }).messages;
  if (!Array.isArray(rows)) return [];
  const kept: TranscriptRow[] = [];
  for (const raw of rows) {
    if (raw === null || typeof raw !== "object") continue;
    const row = raw as { ID?: unknown; SpeakerID?: unknown; MessageType?: unknown; Payload?: unknown; Turn?: unknown };
    if (typeof row.ID !== "number" || typeof row.SpeakerID !== "number") continue;
    kept.push({
      id: row.ID,
      speakerID: row.SpeakerID,
      messageType: typeof row.MessageType === "string" ? row.MessageType : "",
      payload:
        row.Payload !== null && typeof row.Payload === "object" ? (row.Payload as Record<string, unknown>) : {},
      turn: typeof row.Turn === "number" ? row.Turn : 0
    });
  }
  return kept;
}

// Say what a stored proposal offers, in the words a seat reading it expects.
//
// The game stores terms as per-side items, so each one is written as who pays
// whom rather than as a single figure the seat would have to attribute itself.
export function readTerms(payload: Record<string, unknown>, nameOf: (id: number) => string): string {
  const deal = payload.Deal;
  if (deal === null || typeof deal !== "object") return "terms could not be read";
  const items = (deal as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length === 0) return "no terms";
  const parts: string[] = [];
  for (const raw of items) {
    if (raw === null || typeof raw !== "object") continue;
    const item = raw as { fromPlayerID?: unknown; toPlayerID?: unknown; itemType?: unknown; amount?: unknown; duration?: unknown };
    const giver = typeof item.fromPlayerID === "number" ? nameOf(item.fromPlayerID) : "someone";
    const receiver = typeof item.toPlayerID === "number" ? nameOf(item.toPlayerID) : "someone";
    const kind = typeof item.itemType === "string" ? item.itemType : "an item";
    const amount = typeof item.amount === "number" ? String(item.amount) : "some";
    if (kind === "GOLD") parts.push(giver + " pays " + amount + " gold to " + receiver);
    else if (kind === "GOLD_PER_TURN") {
      const turns = typeof item.duration === "number" ? String(item.duration) : "several";
      parts.push(giver + " pays " + amount + " gold per turn for " + turns + " turns to " + receiver);
    } else if (kind === "RESOURCE") {
      const resource = typeof (item as { resourceID?: unknown }).resourceID === "string" ? String((item as { resourceID?: unknown }).resourceID) : "a resource";
      parts.push(giver + " gives " + resource + " to " + receiver);
    } else parts.push(giver + " gives " + kind + " to " + receiver);
  }
  return parts.join("; ");
}

// Parse a tool's text as JSON, or say it was not JSON.
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Read the id a proposal was recorded under, from the row the append returned.
//
// The tool answers with the stored transcript row, whose id is the number both
// sides quote when they answer it.
export function readProposalID(text: string): string | null {
  try {
    const parsed: unknown = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    for (const row of rows) {
      if (row !== null && typeof row === "object") {
        const id = (row as { ID?: unknown; id?: unknown }).ID ?? (row as { id?: unknown }).id;
        if (typeof id === "number" || (typeof id === "string" && id.length > 0)) return String(id);
      }
    }
  } catch {
    // A bare number or a sentence is also an answer, so the text itself is tried.
  }
  const bare = text.trim().replace(/^"|"$/g, "");
  return /^[0-9]+$/.test(bare) ? bare : null;
}

// Read a refusal out of a tool's answer, when the answer carries one.
//
// The game reports a deal it will not enact as a successful call whose payload
// says so, so a failure cannot be recognised from the call's error flag alone.
export function readRefusal(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { Success?: unknown; Result?: unknown; Error?: { Message?: unknown }; Conflict?: unknown };
    if (parsed === null || typeof parsed !== "object") return null;
    if (parsed.Success === false) {
      const message = parsed.Error?.Message;
      return typeof message === "string" ? message.slice(0, 200) : "the game refused the deal";
    }
    if (parsed.Conflict !== undefined) return "the deal conflicts with the game's current state";
    if (parsed.Result === "rejected" || parsed.Result === "conflict") return "the game did not enact the deal: " + String(parsed.Result);
  } catch {
    return null;
  }
  return null;
}
