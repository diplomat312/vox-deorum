// Writes and reads the record of a run.
// One append-only JSONL file per seat keeps a long game cheap to write and
// safe to interrupt: a lost process costs at most the turn in flight, and a
// finished run is complete on disk without any final flush step.

import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { TraceOutcome, TraceRecord, TraceSummary } from "./types.js";

// Every outcome a record may carry, used to build a complete outcome count.
const allOutcomes: TraceOutcome[] = ["committed", "passed", "unfinished", "failed"];

// A run's record store, rooted at one directory.
export class TraceStore {
  // The run identifier every record carries.
  readonly runId: string;

  // The directory holding the run's files.
  readonly directory: string;

  // Build a store for one run. The run identifier also names the directory, so
  // two runs never share a file.
  constructor(directory: string, runId: string) {
    this.directory = directory;
    this.runId = runId;
  }

  // The file one seat's turns are appended to.
  private seatFile(seat: string): string {
    return path.join(this.directory, seat + ".jsonl");
  }

  // Append one turn. The record is written as a single line so a partial write
  // can only ever lose the last turn, never corrupt an earlier one.
  async record(entry: TraceRecord): Promise<void> {
    if (entry.runId !== this.runId) {
      throw new Error(
        "A record for run '" + entry.runId + "' cannot be written to the store for run '" + this.runId + "'"
      );
    }
    await mkdir(this.directory, { recursive: true });
    await appendFile(this.seatFile(entry.seat), JSON.stringify(entry) + "\n", "utf8");
  }

  // Read every turn one seat took, in the order it took them.
  async readSeat(seat: string): Promise<TraceRecord[]> {
    return readRecords(this.seatFile(seat));
  }

  // Read every seat's turns, keyed by seat, with seats in a stable order.
  async readAll(): Promise<Map<string, TraceRecord[]>> {
    const entries = await listSeatFiles(this.directory);
    const records = new Map<string, TraceRecord[]>();
    for (const seat of entries) {
      records.set(seat, await this.readSeat(seat));
    }
    return records;
  }

  // Summarise a run without reading anything twice: seats, turn span, outcome
  // counts and token and spend totals.
  async summary(): Promise<TraceSummary> {
    const records = await this.readAll();
    const seats = [...records.keys()];
    const outcomes = { committed: 0, passed: 0, unfinished: 0, failed: 0 } as Record<TraceOutcome, number>;
    const totals = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
    let turnCount = 0;
    let firstTurn: number | null = null;
    let lastTurn: number | null = null;
    for (const seatRecords of records.values()) {
      for (const record of seatRecords) {
        turnCount += 1;
        if (allOutcomes.includes(record.outcome)) outcomes[record.outcome] += 1;
        firstTurn = firstTurn === null ? record.turn : Math.min(firstTurn, record.turn);
        lastTurn = lastTurn === null ? record.turn : Math.max(lastTurn, record.turn);
        totals.input += record.usage.input;
        totals.output += record.usage.output;
        totals.reasoning += record.usage.reasoning;
        totals.cacheRead += record.usage.cacheRead;
        totals.cacheWrite += record.usage.cacheWrite;
        totals.cost += record.usage.cost ?? 0;
      }
    }
    return { runId: this.runId, game: firstGame(records), seats, turnCount, firstTurn, lastTurn, totals, outcomes };
  }
}

// Read a JSONL file of records. A missing file means the seat took no turns.
async function readRecords(file: string): Promise<TraceRecord[]> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const records: TraceRecord[] = [];
  text.split("\n").forEach((line, index) => {
    if (line.trim().length === 0) return;
    try {
      records.push(JSON.parse(line) as TraceRecord);
    } catch {
      throw new Error("The trace file " + file + " holds a damaged line at line " + (index + 1));
    }
  });
  return records;
}

// The seat files in a run directory, as seat names in a stable order.
async function listSeatFiles(directory: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => path.basename(name, ".jsonl"))
    .sort();
}

// The game label a run played, read from the first record found.
function firstGame(records: Map<string, TraceRecord[]>): string {
  for (const seatRecords of records.values()) {
    if (seatRecords.length > 0) return seatRecords[0].game;
  }
  return "unknown";
}
