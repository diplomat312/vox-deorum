// Where a seat's private mind and its public word come apart.
//
// The roundup reads what each seat was thinking. This reads the gap between that
// and what the seat said: a seat that plans to take what it has promised not to
// touch, or that keeps a neighbour calm while it decides to move on it. That gap
// is the most interesting thing a game of private intentions can produce, and it
// is invisible to every count of messages, because a two-faced turn and an
// honest one produce exactly the same traffic.
//
// Both quotes are kept for every reading, so a person decides whether the seat
// was two-faced rather than being told. The extraction is over wording and is a
// heuristic; the quotes are the evidence.

import type { MessageMove } from "./quality.js";
import { classifyMessage } from "./quality.js";
import type { Party } from "./roundup.js";
import { namedParty } from "./roundup.js";
import type { TraceRecord } from "../trace/types.js";

// How a seat's private intention relates to what it said.
export type DivergenceKind =
  // The seat meant someone harm and said something warm to them, or to the room
  // about them, in the same turn.
  | "two-faced"
  // The seat meant someone harm and said nothing to anyone, so the intention is
  // its own.
  | "unspoken";

// One reading where the private mind and the public word do not match.
export interface DivergenceMoment {
  // The seat that thought it.
  seat: string;
  // The turn it thought it on.
  turn: number;
  // Which kind of gap this is.
  kind: DivergenceKind;
  // The party the intention concerned, when the sentence named one.
  about: string | null;
  // The seat's own words, so the reading can be checked.
  privateQuote: string;
  // What the seat said in the same turn, when it said anything.
  said: { to: string; text: string; moves: MessageMove[] } | null;
}

// The opening of a sentence that states an intention: the seat itself, then a
// verb of intent rather than a possibility.
//
// The first version of this matched a bare verb, and every reading it produced
// on a real run was wrong. It read "the Iroquois do not strike first", which is a
// promise, as a plan to strike; it read "if they wanted to mislead", which is a
// seat reasoning about being deceived, as a seat planning to deceive; and it read
// "I might mislead", which is a seat worrying about giving bad advice, as intent.
//
// So a reading now needs three things together: the seat itself as the subject,
// a strong verb of intent, and no negation governing the verb. Wondering whether
// a neighbour can be trusted is ordinary statecraft and is left to the roundup;
// this is only for a seat deciding to take something from a neighbour while
// calling it a friend.
const intentLead =
  /\b(?:i|we)\s+(?:will|shall|'ll|am going to|are going to|intend to|plan to|mean to|am preparing to|are preparing to|am about to|are about to)\b/gi;

// How far after the opening to look for the thing intended.
const intentWindow = 60;

// What a seat intends to do to someone, or to a promise it made.
const coldVerbs =
  /^(\s*)((?:attack|invade|conquer|strike|take (?:their|his|her) (?:city|cities|land|capital)|eliminate|destroy|wipe (?:them|him|her) out|declare war on|backstab|betray|double-?cross|break (?:my|our) (?:word|promise|pledge)|go back on|renege|deceive|mislead|lie to|exploit|take advantage of|abandon|string (?:them|him|her) along|keep (?:them|him|her) (?:calm|quiet|sweet)|placate|appease|stall (?:them|him|her))\b)/i;

// How far back to look for a word that turns the verb into its opposite.
const negationWindow = 24;

// Whether a word before the verb makes it a refusal rather than an intention.
function negated(sentence: string, verbAt: number): boolean {
  const before = sentence.slice(Math.max(0, verbAt - negationWindow), verbAt);
  return /\b(?:not|never|no|n't|refuse|decline)\b/i.test(before);
}

// How much of a quote to keep, matching the roundup so the two read alike.
const maxQuoteLength = 320;

// Tidy a quote the way the roundup does, cutting a drafted message off the end.
function tidy(quote: string): string {
  const quoted = quote.indexOf('"');
  const trimmed = quoted > 20 ? quote.slice(0, quoted).trim() : quote;
  return trimmed.length > maxQuoteLength ? trimmed.slice(0, maxQuoteLength - 3) + "..." : trimmed;
}

// Split thinking into sentences the way the roundup does.
function sentences(text: string): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return [];
  return cleaned
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 20);
}

// Whether a sentence states that this seat intends someone harm.
//
// The verb has to follow the seat's own declaration of intent within a short
// window, which is what keeps a sentence about someone else's plan out of it.
export function statesColdIntent(sentence: string): boolean {
  intentLead.lastIndex = 0;
  let lead = intentLead.exec(sentence);
  while (lead !== null) {
    const from = lead.index + lead[0].length;
    const rest = sentence.slice(from, from + intentWindow);
    const verb = coldVerbs.exec(rest);
    // The verb pattern allows the space the lead left behind, so where the verb
    // itself starts is the window plus that space.
    if (verb !== null && !negated(sentence, from + verb[1].length)) return true;
    lead = intentLead.exec(sentence);
  }
  return false;
}

// The sentences in a seat's thinking that mean it intends someone harm.
export function coldSentences(reasoning: string): string[] {
  return sentences(reasoning).filter((sentence) => statesColdIntent(sentence));
}

// One thing a seat said this turn, as it appears in the trace.
export interface SaidOperation {
  // The seat it was aimed at, or the scope it was sent to.
  to: string;
  // The body, when it had one.
  text: string;
}

// The social operations a recorded turn carries.
//
// A turn's own record holds what the seat asked to say, so the words and the
// thinking come from the same place and line up by turn rather than by a
// timestamp the two sides would have to agree on.
export function saidOperations(record: TraceRecord): SaidOperation[] {
  const said: SaidOperation[] = [];
  for (const call of record.toolCalls ?? []) {
    // A live seat's tools are served under the game's server name, so the prefix
    // is stripped the way the runtime strips it.
    const tool = call.tool.replace(/^vox-civ_/, "");
    if (tool !== "communicate") continue;
    const input = (call.input ?? {}) as { operations?: unknown };
    if (!Array.isArray(input.operations)) continue;
    for (const raw of input.operations) {
      if (raw === null || typeof raw !== "object") continue;
      const operation = raw as { kind?: unknown; to?: unknown; message?: unknown };
      if (typeof operation.message !== "string" || operation.message.trim() === "") continue;
      const kind = typeof operation.kind === "string" ? operation.kind : "unknown";
      const target = typeof operation.to === "string" ? operation.to : kind;
      said.push({ to: target, text: operation.message });
    }
  }
  return said;
}

// Whether a move is warm, meaning anything but a grievance or a demand.
//
// A seat that accuses someone of breaking faith is not concealing anything, and
// neither is a seat that refers to the machinery, so those are not counted as
// words that hide a cold intention.
function warm(moves: MessageMove[]): boolean {
  return !moves.includes("accusation") && !moves.includes("demand") && !moves.includes("meta");
}

// Find every reading where a seat's private mind and its public word come apart.
export function buildDivergence(records: TraceRecord[], parties: Party[] = []): DivergenceMoment[] {
  const moments: DivergenceMoment[] = [];
  const seen = new Set<string>();
  const ordered = [...records].sort((left, right) => left.turn - right.turn || left.seat.localeCompare(right.seat));
  for (const record of ordered) {
    const thought = record.reasoning ?? "";
    if (thought.trim() === "") continue;
    const cold = coldSentences(thought);
    if (cold.length === 0) continue;
    const said = saidOperations(record);
    for (const sentence of cold) {
      const about = namedParty(sentence, parties, record.seat);
      // The seat's own words are preferred when they name the party; otherwise
      // anything it said this turn is weighed against the private reading.
      const addressing =
        said.find((entry) => about !== null && new RegExp("\\b" + about + "\\b", "i").test(entry.text)) ?? said[0];
      const classified = addressing ? classifyMessage(record.seat, addressing.to, addressing.text) : null;
      const kind: DivergenceKind = classified && warm(classified.moves) ? "two-faced" : "unspoken";
      const quote = tidy(sentence);
      const key = record.seat + ":" + kind + ":" + quote.slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      moments.push({
        seat: record.seat,
        turn: record.turn,
        kind,
        about,
        privateQuote: quote,
        said: classified ? { to: classified.to, text: classified.text, moves: classified.moves } : null
      });
    }
  }
  return moments;
}

// Render the readings as an account.
export function renderDivergence(
  moments: DivergenceMoment[],
  runId: string,
  seats: string[],
  seatTitles: Record<string, string> = {}
): string {
  const lines: string[] = [];
  const twoFaced = moments.filter((moment) => moment.kind === "two-faced").length;
  lines.push("# Private mind against public word: " + runId);
  lines.push("");
  lines.push(
    "Where a seat intended someone harm and its words in the same turn did not say so. " +
      twoFaced +
      " of " +
      moments.length +
      " readings had something warm said over them."
  );
  lines.push("");
  if (moments.length === 0) {
    lines.push("No seat said one thing while thinking another, and no seat's hostile intention went unspoken.");
    lines.push("");
    return lines.join("\n");
  }
  for (const seat of seats) {
    const mine = moments.filter((moment) => moment.seat === seat);
    if (mine.length === 0) continue;
    lines.push("## " + (seatTitles[seat] ?? seat));
    lines.push("");
    for (const moment of mine) {
      const about = moment.about ? " about " + moment.about : "";
      lines.push("- **turn " + moment.turn + "**, " + moment.kind + about + ": " + moment.privateQuote);
      if (moment.said) lines.push("  - said to " + moment.said.to + ": " + moment.said.text.slice(0, 240));
    }
    lines.push("");
  }
  return lines.join("\n");
}
