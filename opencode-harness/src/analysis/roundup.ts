// Reconstructs what a seat was thinking across a game.
//
// The trace keeps a seat's reasoning turn by turn, which is raw material rather
// than a story. This pulls out the moments that carry the arc: what a seat
// intended, whom it began to distrust, what it made of a betrayal, and when it
// changed its stance toward someone. Reading a game back through them is the
// difference between a log and an account of what happened.
//
// The extraction is over wording, so it is a heuristic. Every moment keeps the
// sentence it came from, so a reader can judge the reading rather than trust it.

import type { TraceRecord } from "../trace/types.js";

// What kind of moment a line from a seat's thinking is.
export type RoundupKind =
  // A seat states what it intends to do.
  | "intention"
  // A seat begins to distrust or watch another.
  | "suspicion"
  // A seat reacts to something that happened to it.
  | "reaction"
  // A seat commits to a course, typically alongside a decision.
  | "commitment"
  // A seat notes that its own view of someone has changed.
  | "shift";

// One moment worth keeping from a seat's thinking.
export interface RoundupMoment {
  // The seat that thought it.
  seat: string;
  // The turn it thought it on.
  turn: number;
  // What kind of moment it is.
  kind: RoundupKind;
  // The sentence it came from, so the reading can be checked.
  quote: string;
  // The seat it concerns, when the sentence named one.
  about: string | null;
}

// The wording that marks each kind of moment, in the order they are checked.
const momentRules: Array<{ kind: RoundupKind; pattern: RegExp }> = [
  {
    kind: "reaction",
    pattern:
      /\b(crisis|broke (?:their|his|her) word|betray|declared war|at war|attack(?:ed)? us|threaten|ultimatum|insult|snub|grievance|they lied)\b/i
  },
  {
    kind: "suspicion",
    pattern:
      /\b(suspect|suspicious|distrust|wary|worrying|worried|concerning|uneasy|caution|watch (?:them|him|her)|do not trust|can't trust|cannot trust|double agent|may be lying|likely (?:a|an) (?:trap|feint))\b/i
  },
  {
    // A change of stance is only worth reporting when it is about a party. A
    // seat reconsidering its own research is deliberation, not an arc.
    kind: "shift",
    pattern:
      /\b(changed my (?:view|mind|read) (?:of|on|about)|no longer trust|no longer (?:see|count)|now (?:hostile|friendly|wary) (?:toward|to|about)|has turned (?:hostile|cold|warm)|previously thought|i had (?:read|judged) (?:them|him|her) wrong|revise my (?:view|read) of|second thoughts about)\b/i
  },
  {
    kind: "commitment",
    pattern:
      /\b(i will (?:commit|pledge|offer|send|give|hold|keep|carry|speak|bring|warn|tell|pass)|we will (?:trade|hold|keep|carry)|my pledge|i accept|i agree|i refuse|i reject|i decline|i (?:offered|proposed|welcomed) (?:them|him|her|this|that))\b/i
  },
  {
    kind: "intention",
    pattern:
      /\b(i (?:intend|plan|aim) to|my (?:plan|goal|aim|strategy) is|i (?:will|shall) (?:settle|expand|build|grow|research|adopt|fortify|explore)|we (?:will|shall) (?:settle|expand|build|grow)|i am going to (?:settle|expand|build|grow|propose|offer))\b/i
  }
];

// How much of a sentence to keep. A moment is a line a person reads, not a
// transcript, and the point is to make the arc visible rather than exhaustive.
const maxQuoteLength = 320;

// Tidy a quote before it is kept.
//
// A seat drafting a message writes the message inside its own reasoning, so a
// sentence can open with prose and then carry the draft. Cutting at the first
// quotation mark keeps the part the seat was thinking rather than the part it
// was about to send.
function tidy(quote: string): string {
  const quoted = quote.indexOf('"');
  const trimmed = quoted > 20 ? quote.slice(0, quoted).trim() : quote;
  return trimmed.length > maxQuoteLength ? trimmed.slice(0, maxQuoteLength - 3) + "..." : trimmed;
}

// Split thinking into sentences, keeping them short enough to read.
function sentences(text: string): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return [];
  // A full stop, question mark or exclamation followed by a space ends a
  // sentence. Decimals and abbreviations are rare in this writing, so the
  // simple rule is good enough and stays predictable.
  return cleaned
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 20);
}

// Find the party a sentence is about, if it names one.
//
// Every name a seat answers to is given, so the match works whether a seat
// wrote "Austria", "Maria Theresa" or the seat id. The author's own names are
// excluded, because a seat naming itself is not talking about someone else.
export interface Party {
  // The seat the party is.
  seat: string;
  // The name to show a reader, which is the civilization rather than the id.
  display: string;
  // Every name the party answers to, including the seat id.
  names: string[];
}

// Find the party a sentence is about, if it names one.
export function namedParty(sentence: string, parties: Party[], author: string): string | null {
  const self = parties.find((party) => party.seat === author);
  const mine = new Set([author, ...(self?.names ?? [])].map((name) => name.toLowerCase()));
  for (const party of parties) {
    for (const name of party.names) {
      if (mine.has(name.toLowerCase())) continue;
      if (new RegExp("\\b" + name + "\\b", "i").test(sentence)) return party.display;
    }
  }
  return null;
}

// Pull the moments out of one run's trace.
//
// Each seat turn contributes at most a few moments, so a long game reads as an
// arc rather than as a wall of thinking. A turn that repeats what an earlier
// turn said is skipped, which is what keeps a seat that passes ten turns in a
// row from filling the page with the same sentence.
export function buildRoundup(
  records: TraceRecord[],
  parties: Party[] = []
): RoundupMoment[] {
  const moments: RoundupMoment[] = [];
  const seen = new Set<string>();
  for (const record of [...records].sort((left, right) => left.turn - right.turn || left.seat.localeCompare(right.seat))) {
    const thought = record.reasoning ?? "";
    if (thought.trim().length === 0) continue;
    let takenForThisTurn = 0;
    for (const sentence of sentences(thought)) {
      if (takenForThisTurn >= 2) break;
      const rule = momentRules.find((entry) => entry.pattern.test(sentence));
      if (!rule) continue;
      const quote = tidy(sentence);
      const key = record.seat + ":" + rule.kind + ":" + quote.slice(0, 60);
      if (seen.has(key)) continue;
      seen.add(key);
      moments.push({
        seat: record.seat,
        turn: record.turn,
        kind: rule.kind,
        quote,
        about: namedParty(sentence, parties, record.seat)
      });
      takenForThisTurn += 1;
    }
  }
  return moments;
}

// Render the moments as an account, grouped by seat and ordered by turn.
export function renderRoundup(
  moments: RoundupMoment[],
  runId: string,
  seats: string[],
  seatTitles: Record<string, string> = {}
): string {
  const lines: string[] = [];
  lines.push("# Roundup: " + runId);
  lines.push("");
  lines.push("What each seat was thinking as the game went, taken from its own reasoning. Every line is a sentence it wrote, so a reading can be checked against what produced it.");
  lines.push("");
  const height = seats.map((seat) => [seat, moments.filter((moment) => moment.seat === seat).length] as const);
  lines.push("| Seat | Moments |");
  lines.push("| --- | --- |");
  for (const [seat, count] of height) lines.push("| " + (seatTitles[seat] ?? seat) + " | " + count + " |");
  lines.push("");
  for (const seat of seats) {
    const mine = moments.filter((moment) => moment.seat === seat);
    lines.push("## " + (seatTitles[seat] ?? seat));
    lines.push("");
    if (mine.length === 0) {
      lines.push("Nothing worth reporting was recorded for this seat.");
      lines.push("");
      continue;
    }
    for (const moment of mine) {
      const about = moment.about ? " about " + moment.about : "";
      lines.push("- **turn " + moment.turn + "**, " + moment.kind + about + ": " + moment.quote);
    }
    lines.push("");
  }
  return lines.join("\n");
}
