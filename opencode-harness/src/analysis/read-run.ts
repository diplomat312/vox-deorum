// Reads a finished run back in.
// A run leaves three things behind: the trace, which is what each seat knew,
// thought and did; the social log, which is what the seats said to each other;
// and the tool call log, which is what they asked for. This module gathers the
// three into one shape so a report or a roundup never has to know the file
// layout.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { SocialEntry } from "../social/social-store.js";
import { TraceStore } from "../trace/store.js";
import type { TraceRecord } from "../trace/types.js";

// One tool call a seat made, as the tool server recorded it.
export interface RunToolCall {
  // When the call was answered.
  at: string;
  // The seat that called.
  seat: string;
  // The turn it was answered for, or null when no turn could be read.
  turn: number | null;
  // The tool the seat called.
  tool: string;
  // The arguments the seat passed.
  arguments: unknown;
  // The text the seat was handed.
  result: string;
}

// Everything one run left behind.
export interface RunData {
  // The run identifier.
  runId: string;
  // The game the seats played.
  game: string;
  // The trace, keyed by seat, in turn order.
  trace: Map<string, TraceRecord[]>;
  // Everything the seats said, in order.
  social: SocialEntry[];
  // Everything the seats asked for, in order.
  toolCalls: RunToolCall[];
  // The harness build that played this run, when the run recorded one. A run
  // whose build is unknown cannot be compared with another as though the same
  // code produced both, so the report says which it is.
  build: string | null;
}

// Read a JSONL file, returning an empty list when it does not exist.
async function readJsonLines<T>(file: string): Promise<T[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return [];
  }
  const rows: T[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      rows.push(JSON.parse(line) as T);
    } catch {
      // A damaged line is skipped rather than failing the whole read: a report
      // is worth having even when one line of a long run was lost.
    }
  }
  return rows;
}

// Read the build a run recorded, or null when it did not record one.
async function readBuild(runDirectory: string): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(runDirectory, "summary.json"), "utf8"));
    if (parsed !== null && typeof parsed === "object") {
      const build = (parsed as { build?: unknown }).build;
      if (typeof build === "string" && build !== "") return build;
    }
  } catch {
    // A run from before the build was recorded simply has none.
  }
  return null;
}

// Read one run directory.
export async function readRun(runDirectory: string): Promise<RunData> {
  const traceDirectory = path.join(runDirectory, "trace");
  const socialDirectory = path.join(runDirectory, "social");
  const runId = path.basename(runDirectory);
  const store = new TraceStore(traceDirectory, runId);
  const trace = await store.readAll();
  const social = await readJsonLines<SocialEntry>(path.join(socialDirectory, "social.jsonl"));
  const toolCalls = await readJsonLines<RunToolCall>(path.join(socialDirectory, "tool-calls.jsonl"));
  const game = firstGame(trace);
  return { runId, game, trace, social, toolCalls, build: await readBuild(runDirectory) };
}

// Every turn a run recorded, across seats, in turn then seat order.
export function allTurns(data: RunData): TraceRecord[] {
  const turns: TraceRecord[] = [];
  for (const records of data.trace.values()) turns.push(...records);
  return turns.sort((left, right) => left.turn - right.turn || left.seat.localeCompare(right.seat));
}

// The game a run played, taken from the first recorded turn.
function firstGame(trace: Map<string, TraceRecord[]>): string {
  for (const records of trace.values()) {
    if (records.length > 0) return records[0].game;
  }
  return "unknown";
}

// List the run directories under a runs directory, newest name last.
export async function listRuns(runsDirectory: string): Promise<string[]> {
  try {
    const entries = await readdir(runsDirectory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}
