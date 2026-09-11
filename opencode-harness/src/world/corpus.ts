// Reads the recorded-game fixtures that the replay world serves.
// One file per seat, one JSON object per line, one line per turn.
// The loader is strict: a record that is incomplete stops the load instead of
// quietly shrinking the game a seat is about to play.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { DecisionKind, RecordedToolCall, WorldTurn } from "./types.js";

// The only decision kinds a recorded turn may carry.
const decisionKinds: DecisionKind[] = ["commit", "pass", "none"];

// Stop the load with a message that names the file and line at fault.
function fail(source: string, lineNumber: number, detail: string): never {
  throw new Error("Cannot read the corpus at " + source + " line " + lineNumber + ": " + detail);
}

// Read a field that must be present text.
function requireText(value: unknown, key: string, source: string, lineNumber: number): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(source, lineNumber, "the field '" + key + "' must be a non-empty string");
  }
  return value;
}

// Read a field that may hold text or nothing.
function optionalText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

// Read a field that may hold a number or nothing.
function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Read the tool calls of one turn. A missing list means the seat called nothing.
function readToolCalls(value: unknown, source: string, lineNumber: number): RecordedToolCall[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(source, lineNumber, "the field 'toolCalls' must be an array");
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) {
      fail(source, lineNumber, "tool call " + index + " is not an object");
    }
    const call = entry as Record<string, unknown>;
    return {
      tool: requireText(call.tool, "toolCalls[].tool", source, lineNumber),
      input: call.input ?? null,
      output: optionalText(call.output),
      error: optionalText(call.error),
      status: optionalText(call.status)
    };
  });
}

// Read the decision that ended a turn, defaulting to "none" when the recording
// did not state one.
function readDecision(value: unknown): DecisionKind {
  return typeof value === "string" && (decisionKinds as string[]).includes(value)
    ? (value as DecisionKind)
    : "none";
}

// Turn one recorded line into a turn, or explain what is wrong with it.
function parseTurn(text: string, source: string, lineNumber: number): WorldTurn {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(source, lineNumber, "the line is not valid JSON (" + String(error) + ")");
  }
  if (typeof parsed !== "object" || parsed === null) {
    fail(source, lineNumber, "the line is not a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  const turn = optionalNumber(record.turn);
  if (turn === null) fail(source, lineNumber, "the field 'turn' must be a number");
  return {
    game: requireText(record.game, "game", source, lineNumber),
    seat: requireText(record.seat, "seat", source, lineNumber),
    playerID: optionalNumber(record.playerID),
    turn,
    session: optionalText(record.session),
    observation: requireText(record.observation, "observation", source, lineNumber),
    toolCalls: readToolCalls(record.toolCalls, source, lineNumber),
    modelText: optionalText(record.modelText),
    decision: readDecision(record.decision)
  };
}

// Parse a whole seat file, ordered by turn so replays are reproducible.
export function parseCorpus(text: string, source: string): WorldTurn[] {
  const lines = text.split("\n");
  const turns: WorldTurn[] = [];
  lines.forEach((line, index) => {
    if (line.trim().length === 0) return;
    turns.push(parseTurn(line, source, index + 1));
  });
  return turns.sort((left, right) => left.turn - right.turn);
}

// Read one seat's fixture from a corpus directory.
export async function loadCorpusSeat(directory: string, seat: string): Promise<WorldTurn[]> {
  const file = path.join(directory, seat + ".jsonl");
  const text = await readFile(file, "utf8");
  return parseCorpus(text, file);
}

// Read every seat fixture in a corpus directory. The seat list comes from the
// file names in sorted order so two loads always produce the same world.
export async function loadCorpusDirectory(directory: string): Promise<Map<string, WorldTurn[]>> {
  const entries = await readdir(directory);
  const files = entries.filter((name) => name.endsWith(".jsonl")).sort();
  const corpus = new Map<string, WorldTurn[]>();
  for (const file of files) {
    const seat = path.basename(file, ".jsonl");
    corpus.set(seat, await loadCorpusSeat(directory, seat));
  }
  return corpus;
}
