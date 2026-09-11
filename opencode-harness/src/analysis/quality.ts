// What a message actually does, as opposed to how many messages there were.
//
// Counting messages measures quantity and says nothing about quality: a table
// exchanging courtesies and a table negotiating a border both produce traffic.
// This reads the text of each message and labels what it is for, so a variant
// can be judged on whether the talking got more substantive rather than merely
// louder.
//
// The labels are read from wording, so this is a heuristic rather than a
// judgement. It is deliberately plain and inspectable: every rule is a pattern
// a person can read and disagree with, and the categories are chosen so that a
// wrong label is obvious when the messages are read back.

// What a message is doing.
import { civDefinitions } from "../world/simulated/content.js";

// What a message is doing.
export type MessageMove =
  // Courteous opening or closing with no request and no information: the
  // "greetings, may our paths cross in goodwill" register.
  | "ceremony"
  // Shares a fact about the world, such as a military build-up or a research
  // direction, that the reader did not know.
  | "information"
  // Suggests an arrangement, a course of action or a trade.
  | "proposal"
  // Promises something about the sender's own future conduct.
  | "commitment"
  // Asks the reader for something, or warns it of a consequence.
  | "demand"
  // Asks the reader a question.
  | "question"
  // Names a grievance against the reader or another seat.
  | "accusation"
  // Offers repair for harm: apology, restitution or amends.
  | "apology"
  // Refers to the machinery around the game rather than the game itself, such
  // as the simulation, the scenario, the harness or a scripted event. This is
  // an immersion leak and a cost of how circumstances are delivered.
  | "meta";

// One message, labelled.
export interface LabelledMessage {
  // The seat that sent it.
  from: string;
  // The scope it was sent to, such as "world" or a direct pair.
  to: string;
  // The body, when it had one.
  text: string;
  // Every move the wording supports, in the order the rules are checked.
  moves: MessageMove[];
}

// The wording rules, in the order they are checked. A message may match several
// rules, so a pledge that also asks for something is labelled both.
const rules: Array<{ move: MessageMove; pattern: RegExp }> = [
  {
    move: "meta",
    pattern:
      /\b(sim|simulation|simulated|scripted|scenario|harness|the system|the prompt|the game engine|injected|game state file)\b/i
  },
  {
    move: "apology",
    pattern:
      /\b(apolog|amends|restitution|make it right|i owe you|you are owed|i was wrong|forgive|atone|rebuild what|first step toward)\b/i
  },
  {
    move: "accusation",
    pattern: /\b(broke your word|broken word|betray|you lied|deceiv|treacher|bad faith|you have harmed|grievance against|you failed)\b/i
  },
  {
    move: "proposal",
    pattern:
      /\b(shall we|i propose|we propose|let us|let's|i suggest|i offer|we offer|would you consider|i would welcome (?:an|a) (?:understanding|arrangement|agreement|pact|deal)|join me|join us|in exchange|in return for|in return,? we|terms)\b/i
  },
  {
    move: "commitment",
    pattern:
      /\b(we will not|will not|we shall not|shall not|i pledge|we pledge|my word|our word|we promise|i promise|we stand by|i stand by|keep the faith|we keep|holds? to|we guarantee|will be honored|will be honoured|no claim on|no design on|hold no|claims? no|only to defend|for defense alone|for defence alone)\b/i
  },
  {
    move: "demand",
    pattern:
      /\b(i ask|we ask|i request|we request|i demand|we demand|withdraw|cease|stop|must not|you must|do not (?:move|settle|expand|raise)|or else|otherwise we will|i expect|we expect|require|a calm word from you|would steady|steady many minds|i would gladly carry|i would have you)\b/i
  },
  {
    move: "question",
    pattern: /\?/
  },
  {
    move: "information",
    pattern:
      /\b(i have seen|we have seen|i saw|we saw|has been noticed|our levy|my levy|our arms|my arms|we are (?:researching|building|massing)|i am (?:researching|building)|our treasury|my treasury|granted|agreed|concluded|accepted|refused|declined|is empty|are for (?:defense|defence)|guard only)\b/i
  }
];

// The moves that carry substance rather than courtesy. A message that only
// greets is ceremony; everything else asks, tells, promises or repairs.
const substantiveMoves: MessageMove[] = [
  "information",
  "proposal",
  "commitment",
  "demand",
  "question",
  "accusation",
  "apology"
];

// Every name a seat answers to in a message: its seat id, its civilization and
// its leader. A model writes "Austria" or "Maria Theresa", so a measure that
// only knew seat ids would report that nothing was ever addressed to anyone.
// A seat whose civilization the harness does not know contributes its id alone.
export function partyNamesFor(seats: string[]): string[] {
  const names: string[] = [];
  for (const seat of seats) {
    names.push(seat);
    const known = civDefinitions.find((entry) => entry.seat === seat);
    if (known) names.push(known.civ, known.leader);
  }
  return names;
}

// Label one message.
export function classifyMessage(from: string, to: string, text: string | null): LabelledMessage {
  const body = text ?? "";
  const moves = rules.filter((rule) => rule.pattern.test(body)).map((rule) => rule.move);
  // A message that matched nothing is courtesy rather than nothing: it was sent
  // as speech and said something pleasant, which is the default register.
  if (moves.length === 0) moves.push("ceremony");
  return { from, to, text: body, moves };
}

// Whether a labelled message carries substance rather than only courtesy.
export function isSubstantive(message: LabelledMessage): boolean {
  return message.moves.some((move) => substantiveMoves.includes(move));
}

// Whether a message names another party, which is the difference between
// writing to someone and addressing the room.
//
// The names looked for are not only the harness's seat ids. In a real game a
// seat writes "Austria" or "Hiawatha", never "austria", so a measure that only
// knew seat ids would report that every message was addressed to the room.
export function namesAnotherSeat(message: LabelledMessage, names: string[], selfNames: string[] = []): boolean {
  const body = message.text;
  const mine = new Set([message.from.toLowerCase(), ...selfNames.map((name) => name.toLowerCase())]);
  return names.some((name) => !mine.has(name.toLowerCase()) && new RegExp("\\b" + name + "\\b", "i").test(body));
}

// What a run's messages did, taken together.
export interface QualityMetrics {
  // Every message sent.
  messages: number;
  // How many messages carried each move. A message may count in several moves.
  byMove: Record<MessageMove, number>;
  // Messages that carried substance rather than only courtesy.
  substantive: number;
  // Share of messages that carried substance.
  substantiveRate: number;
  // Messages that named another seat rather than addressing the room.
  personalised: number;
  // Share of messages that named another seat.
  personalisedRate: number;
  // Messages that referred to the machinery rather than the game.
  meta: number;
  // Share of messages that leaked immersion.
  metaRate: number;
  // How many messages proposed an arrangement, which is the closest reading of
  // whether any of the talk was going somewhere.
  proposals: number;
  // How many messages repaired harm after a grievance, which is the clearest
  // sign that diplomacy achieved something rather than merely occurred.
  repairs: number;
  // Every message, labelled, so a label can be checked against the text.
  labelled: LabelledMessage[];
}

// Label every message a set of entries holds and count what they did.
export function qualityMetrics(
  entries: Array<{ from: string; to?: string; text?: string; kind: string }>,
  seats: string[]
): QualityMetrics {
  const labelled = entries
    // A deal proposal carries a message as well as terms, so it is speech and
    // belongs in the reading of what the seats said.
    .filter(
      (entry) =>
        entry.kind === "world" ||
        entry.kind === "dm" ||
        entry.kind === "group-msg" ||
        entry.kind === "deal-propose"
    )
    .filter((entry) => (entry.text ?? "").trim().length > 0)
    .map((entry) => classifyMessage(entry.from, entry.to ?? "world", entry.text ?? null));
  const byMove = {
    ceremony: 0,
    information: 0,
    proposal: 0,
    commitment: 0,
    demand: 0,
    question: 0,
    accusation: 0,
    apology: 0,
    meta: 0
  } as Record<MessageMove, number>;
  for (const message of labelled) {
    for (const move of message.moves) byMove[move] += 1;
  }
  const substantive = labelled.filter(isSubstantive).length;
  // A message counts as personalised when it names a party other than its
  // author, under any of the names that party answers to.
  const names = partyNamesFor(seats);
  const personalised = labelled.filter((message) => {
    const author = civDefinitions.find((entry) => entry.seat === message.from);
    return namesAnotherSeat(message, names, author ? [author.civ, author.leader] : []);
  }).length;
  const messages = labelled.length;
  return {
    messages,
    byMove,
    substantive,
    substantiveRate: messages === 0 ? 0 : substantive / messages,
    personalised,
    personalisedRate: messages === 0 ? 0 : personalised / messages,
    meta: byMove.meta,
    metaRate: messages === 0 ? 0 : byMove.meta / messages,
    proposals: byMove.proposal,
    repairs: byMove.apology,
    labelled
  };
}
