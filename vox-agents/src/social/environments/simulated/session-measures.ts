// What a social session actually did, read from its own store.
//
// A transcript is evidence but it is not an answer. This reduces one session to
// numbers, so a question about diplomacy can be asked across seeds rather than
// answered by whichever run had the best conversation.
//
// The readings of what a message does are heuristics over wording, deliberately
// plain and inspectable, in the same spirit as the harness's own analysis: every
// rule is a pattern a person can read and disagree with, and each count keeps the
// sentence it came from so a reading can be checked rather than trusted.

import type { SocialMessage } from "../../types.js";

// One message, read for what it is doing.
export interface ReadMessage {
  // The message itself.
  message: SocialMessage;
  // Whether it went to one seat or to the table.
  scope: "world" | "private";
  // What the wording supports, in the order the rules are checked.
  moves: string[];
  // Whether it asks the reader something.
  asks: boolean;
  // Whether it asks about another seat's intentions, which is the intelligence
  // this environment exists to reward.
  probesIntent: boolean;
}

// The wording that marks each move.
const moveRules: Array<{ move: string; pattern: RegExp }> = [
  {
    move: "proposal",
    pattern:
      /\b(i propose|we propose|shall we|let us|let's|i offer|we offer|i suggest|would you consider|in exchange|in return|my terms|our terms|an understanding|a pact|an agreement|i put .{0,20}proposal)\b/i
  },
  {
    move: "commitment",
    pattern:
      /\b(i will not|we will not|i will keep|we will keep|i pledge|we pledge|my word|our word|i promise|we promise|i mean what i say|i keep my word|i stand by|soldiers kept at home|troops remain at home|army stays home)\b/i
  },
  {
    move: "accusation",
    pattern:
      /\b(you broke|broke your word|broken word|betray|you lied|you have lied|bad faith|treacher|you have massed|gathered its host|for the second time|i hold you|solely to blame|judge accordingly|a turn after i|i have kept (?:that promise|my word)|you chose|who moved first)\b/i
  },
  {
    move: "demand",
    pattern:
      /\b(i ask you|i demand|withdraw|recall (?:your|those)|stand down|send your host home|pull (?:it|them) back|bring your army home|you must|do not|or else|i expect|the answer is no|tell me plainly|let us agree|let this be a settled thing)\b/i
  },
  {
    move: "intel",
    pattern: /\b(i am curious|what is the purpose|to what end|for what|do you seek|do you look toward|what do you seek|tell me your|state your)\b/i
  },
  {
    move: "warning",
    pattern:
      /\b(i will defend|we will defend|i will hold|does not leave its gates open|will not be the first|i will answer|judge|will be met|will not be walked on|will cost you|my \d+(?:\.\d+)? stands ready|will know who moved first|will know who)\b/i
  }
];

// The wording that makes a question a question about intent rather than a
// courtesy.
const intentPattern =
  /\b(purpose|intent|intention|aim|mean to|meaning|designs|desire|seek|after|plan|grievance|why|for what|to what end|what end|toward|towards|against|afoot)\b/i;

// The phrasings a seat uses to ask about intent without a question mark.
//
// The models asked roughly as often in the imperative as in the interrogative:
// "Tell me plainly what is afoot" is a question about intent, and a reader that
// only counts question marks reports a table that never asked anything.
const intentImperative = /\b(tell me (?:plainly )?(?:your|what|why|if)|name (?:them|it|your)|say so plainly|state your|i would rather understand)\b/i;

// Read one message.
export function readMessage(message: SocialMessage, worldChannelId: string): ReadMessage {
  const body = message.content ?? "";
  const moves = moveRules.filter((rule) => rule.pattern.test(body)).map((rule) => rule.move);
  const asks = body.includes("?");
  return {
    message,
    scope: message.channelId === worldChannelId ? "world" : "private",
    moves,
    asks,
    probesIntent: (asks || intentImperative.test(body)) && intentPattern.test(body)
  };
}

// What a session did, as a whole.
export interface SessionMeasures {
  // Messages written, split by where they went.
  messages: number;
  worldMessages: number;
  privateMessages: number;
  // Private channels opened, which is how many separate conversations exist.
  privateChannels: number;
  // Seats that never wrote anything.
  seatsSilent: number;
  // The seat that wrote the most, and how much.
  busiestSeat: { seat: string; messages: number } | null;
  // Messages that ask a question, and of those, ones about another seat's intent.
  questions: number;
  intentProbes: number;
  // Messages that propose terms, promise something, accuse, or threaten.
  proposals: number;
  commitments: number;
  accusations: number;
  warnings: number;
  // Orders carried out in the world, by action name.
  actions: Record<string, number>;
  // Orders the world refused.
  refusals: number;
  // How many turns the world reached, read from the highest turn any action
  // landed on.
  turnsObserved: number;
}

// One order that was carried out, as the store records it.
export interface ObservedAction {
  // The seat that acted.
  actorId: string;
  // What kind of decision it was.
  selectedKind: string | null;
  // What the runtime did with it.
  applicationOutcome: string | null;
  // The error, when it failed.
  error: string | null;
}

/** Reduce one session to numbers. */
export function measureSession(
  messages: SocialMessage[],
  worldChannelId: string,
  seats: string[],
  actions: ObservedAction[]
): SessionMeasures {
  const read = messages.map((message) => readMessage(message, worldChannelId));
  const perSeat = new Map<string, number>();
  for (const entry of read) {
    perSeat.set(entry.message.speakerActorId, (perSeat.get(entry.message.speakerActorId) ?? 0) + 1);
  }
  const channels = new Set(messages.filter((message) => message.channelId !== worldChannelId).map((message) => message.channelId));
  const counts: Record<string, number> = {};
  let refusals = 0;
  for (const action of actions) {
    if (action.applicationOutcome === null || action.applicationOutcome === undefined) {
      refusals += 1;
      continue;
    }
    // The outcome names the action after a colon, which is where the verb is.
    const named = action.applicationOutcome.includes(":")
      ? action.applicationOutcome.split(":").slice(1).join(":").trim().slice(0, 40)
      : action.selectedKind ?? "unknown";
    counts[named] = (counts[named] ?? 0) + 1;
  }
  // Ties are broken by seat name so a report is stable: two seats that spoke
  // equally would otherwise swap places between runs of the analyser, which
  // looks like a finding and is not one.
  const ranked = [...perSeat.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  return {
    messages: read.length,
    worldMessages: read.filter((entry) => entry.scope === "world").length,
    privateMessages: read.filter((entry) => entry.scope === "private").length,
    privateChannels: channels.size,
    seatsSilent: seats.filter((seat) => !perSeat.has(seat)).length,
    busiestSeat: ranked.length > 0 ? { seat: ranked[0][0], messages: ranked[0][1] } : null,
    questions: read.filter((entry) => entry.asks).length,
    intentProbes: read.filter((entry) => entry.probesIntent).length,
    proposals: read.filter((entry) => entry.moves.includes("proposal")).length,
    commitments: read.filter((entry) => entry.moves.includes("commitment")).length,
    accusations: read.filter((entry) => entry.moves.includes("accusation")).length,
    warnings: read.filter((entry) => entry.moves.includes("warning")).length,
    actions: counts,
    refusals,
    turnsObserved: actions.length
  };
}

/** Render measures as a small markdown table, for a report beside a transcript. */
export function renderMeasures(measures: SessionMeasures, title: string): string {
  const lines: string[] = [];
  lines.push("# " + title);
  lines.push("");
  lines.push("| Measure | Value |");
  lines.push("| --- | --- |");
  lines.push("| Messages | " + measures.messages + " |");
  lines.push("| Public | " + measures.worldMessages + " |");
  lines.push("| Private | " + measures.privateMessages + " |");
  lines.push("| Private channels | " + measures.privateChannels + " |");
  lines.push("| Seats that never spoke | " + measures.seatsSilent + " |");
  lines.push("| Busiest seat | " + (measures.busiestSeat ? measures.busiestSeat.seat + " (" + measures.busiestSeat.messages + ")" : "none") + " |");
  lines.push("| Questions asked | " + measures.questions + " |");
  lines.push("| Questions about intent | " + measures.intentProbes + " |");
  lines.push("| Proposals | " + measures.proposals + " |");
  lines.push("| Commitments | " + measures.commitments + " |");
  lines.push("| Accusations | " + measures.accusations + " |");
  lines.push("| Warnings | " + measures.warnings + " |");
  lines.push("| Orders refused | " + measures.refusals + " |");
  const actions = Object.entries(measures.actions).sort((left, right) => right[1] - left[1]);
  for (const [name, count] of actions) lines.push("| Action: " + name + " | " + count + " |");
  lines.push("");
  return lines.join("\n");
}
