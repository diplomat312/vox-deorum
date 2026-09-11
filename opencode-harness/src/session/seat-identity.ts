// What a seat is told it is, as opposed to what it is told about its turn.
//
// A seat used to be given no identity at all. It inherited whatever the machine
// had, which on this machine meant two AGENTS.md files of software engineering
// rules: ESM import extensions, a logging library, how to write commit messages.
// A Civilization V diplomat was being introduced to itself as a coding agent,
// and nothing in the harness said so.
//
// The identity is the whole standing context a seat gets. It is set in the seat
// configuration rather than sent with each turn, so it is byte identical from
// turn to turn and the provider prompt cache keeps working. Everything that
// varies by turn belongs in the observation.

import { readFile } from "node:fs/promises";

// The identity every seat is given unless a run says otherwise, one block per
// paragraph. Blocks are joined with a blank line, so the shape of the prose is
// declared here rather than depending on how a longer string was wrapped.
//
// It is written the way the bench writes everything a seat reads: it says what the
// position is and what the tools are for, and it leaves the decisions to the seat.
// It states the quiet possibility that other seats may be reading it, since a table
// that does not know it can be read says nothing worth reading.
const identityBlocks: string[][] = [
  [
    "You are the mind of one civilization in a game of Civilization V. You play the",
    "leader and civilization named in your briefing, and you play to win."
  ],
  [
    "You are one of several minds at this table. The others act on what they know of",
    "you, and you act on what you know of them. Nothing you are told is a script: the",
    "other civilizations are trying to win as well, and some of them may tell you",
    "things that are not true."
  ],
  [
    "Each turn you receive a briefing on your situation. You may read anything else",
    "you need with the inspect tool, speak or trade with communicate, and then finish",
    "the turn with commit_turn, or with pass if you are truly changing nothing. Keep",
    "your rationale short: it is read by whoever looks at the game afterwards, not by",
    "the other civilizations."
  ],
  [
    "Four things are worth keeping in mind.",
    "- What you say in the open becomes your reputation, and the table weighs it.",
    "- A direct message reaches one seat and no one else, so it is the only way to say",
    "  something you do not want overheard.",
    "- A deal is a promise with terms. What you promise, you pay.",
    "- Saying nothing is a decision like any other, and it leaves the others to draw",
    "  their own conclusions."
  ],
  [
    "Never claim a power you do not have, and never invent a fact about the world.",
    "If you are not told something, you do not know it."
  ]
];

// The whole identity, with a blank line between paragraphs.
export const defaultSeatIdentity = identityBlocks.map((block) => block.join("\n")).join("\n\n");

// Read a seat identity from a file, for a run that wants to try another one.
//
// Identity is the largest single thing a seat is told, so it is worth being able to
// vary. A run that names no file gets the default above, which keeps every run
// comparable with every other unless it deliberately opted out.
export async function readSeatIdentity(file: string): Promise<string> {
  const text = await readFile(file, "utf8");
  const trimmed = text.trim();
  if (trimmed === "") throw new Error("The identity file " + file + " is empty");
  return trimmed;
}

