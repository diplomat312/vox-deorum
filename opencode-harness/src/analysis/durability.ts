// Whether a relationship lasts, rather than whether it happened.
//
// Quantity says how much was said and quality says what it was for. Neither
// says whether any of it endured: a burst of messages on consecutive turns and
// a working relationship kept alive across a whole game can have the same
// message count. This reads the shape of the contact instead.
//
// The reading is built from turn numbers rather than timestamps, because a turn
// is what the game has to offer as a unit of time and a run writes its turns in
// order. Two seats that spoke on turns 4, 5 and 6 had a conversation; two that
// spoke on turns 4 and 30 kept a channel open.

import type { TraceRecord } from "../trace/types.js";
import { directPairOf, type SocialEntry } from "../social/social-store.js";

// One pair of seats and how their contact was shaped.
export interface PairDurability {
  // The two seats, in seat order.
  pair: string;
  // Messages exchanged, in both directions.
  messages: number;
  // Distinct turns on which they were in contact.
  turnsInContact: number;
  // The first turn they were in contact.
  firstTurn: number;
  // The last turn they were in contact.
  lastTurn: number;
  // How far apart the first and last contact were, in turns. A wide span with
  // few messages is a channel kept open; a narrow span with many is a single
  // conversation.
  span: number;
  // The longest run of turns with no contact between their first and last,
  // which is how long the relationship went quiet.
  longestQuietGap: number;
  // Contact as a share of the turns in the window, which says whether the two
  // were in touch throughout or only at the ends.
  turnCoverage: number;
}

// What the contacts of a run added up to.
export interface DurabilityMetrics {
  // Each pair that was ever in contact, in seat order.
  pairs: PairDurability[];
  // Pairs that spoke on more than one turn, which is the difference between an
  // exchange and a relationship.
  sustainedPairs: number;
  // The middle span across pairs, in turns.
  medianSpan: number;
  // The middle coverage across pairs.
  medianCoverage: number;
  // Whether a pair was still in contact in the last quarter of the game, which
  // is the plainest reading of a relationship that lasted to the end.
  pairsStillActiveAtEnd: number;
  // The turns the run covered.
  turnsPlayed: number;
  // The last turn recorded.
  lastTurn: number;
}

// The turn a social entry happened on, read from the game rather than the clock.
//
// The log records a wall-clock time, which says nothing about the game. The
// turn comes from the seat that sent it, matched by the seat and the moment the
// message was written.
function turnOfEntry(entry: SocialEntry, records: TraceRecord[]): number | null {
  const at = Date.parse(entry.at);
  if (!Number.isFinite(at)) return null;
  // The record whose window contains the entry, for the sending seat.
  let best: { turn: number; distance: number } | null = null;
  for (const record of records) {
    if (record.seat !== entry.from) continue;
    const started = Date.parse(record.startedAt);
    const completed = Date.parse(record.completedAt);
    if (!Number.isFinite(started) || !Number.isFinite(completed)) continue;
    // A message is written during the turn that sent it, so the containing
    // window wins; otherwise the nearest one does.
    const inside = at >= started && at <= completed;
    const distance = inside ? 0 : Math.min(Math.abs(at - started), Math.abs(at - completed));
    if (!best || distance < best.distance) best = { turn: record.turn, distance };
  }
  return best ? best.turn : null;
}

// Measure how the contact between pairs was shaped.
export function durabilityMetrics(records: TraceRecord[], social: SocialEntry[]): DurabilityMetrics {
  const turns = records.map((record) => record.turn);
  const lastTurn = turns.length === 0 ? 0 : Math.max(...turns);
  const firstTurn = turns.length === 0 ? 0 : Math.min(...turns);

  // Group the direct messages by pair, then by the turn they happened on.
  const byPair = new Map<string, { messages: number; turns: Set<number> }>();
  for (const entry of social) {
    const pair = directPairOf(entry);
    if (pair.length !== 2) continue;
    const key = pair.join("|");
    const turn = turnOfEntry(entry, records);
    const held = byPair.get(key) ?? { messages: 0, turns: new Set<number>() };
    held.messages += 1;
    if (turn !== null) held.turns.add(turn);
    byPair.set(key, held);
  }

  const pairs: PairDurability[] = [];
  for (const [key, held] of byPair) {
    const contactTurns = [...held.turns].sort((left, right) => left - right);
    const first = contactTurns[0] ?? firstTurn;
    const last = contactTurns[contactTurns.length - 1] ?? firstTurn;
    // The longest stretch of turns inside the window with no contact.
    let longestQuietGap = 0;
    for (let index = 1; index < contactTurns.length; index += 1) {
      longestQuietGap = Math.max(longestQuietGap, contactTurns[index] - contactTurns[index - 1] - 1);
    }
    const window = Math.max(1, last - first + 1);
    pairs.push({
      pair: key,
      messages: held.messages,
      turnsInContact: contactTurns.length,
      firstTurn: first,
      lastTurn: last,
      span: last - first,
      longestQuietGap,
      turnCoverage: contactTurns.length / window
    });
  }
  pairs.sort((left, right) => left.pair.localeCompare(right.pair));

  // The last quarter of the game, so a relationship that ran to the end can be
  // told from one that faded early.
  const endThreshold = firstTurn + Math.floor((lastTurn - firstTurn) * 0.75);
  const stillActive = pairs.filter((entry) => entry.lastTurn >= endThreshold).length;
  const spans = pairs.map((entry) => entry.span);
  const coverages = pairs.map((entry) => entry.turnCoverage);
  return {
    pairs,
    sustainedPairs: pairs.filter((entry) => entry.turnsInContact > 1).length,
    medianSpan: median(spans),
    medianCoverage: median(coverages),
    pairsStillActiveAtEnd: stillActive,
    turnsPlayed: new Set(turns).size,
    lastTurn
  };
}

// The middle of a list of numbers.
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}
