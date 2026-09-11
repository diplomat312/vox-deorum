// Watches a run while it plays.
//
// A run writes everything to disk as it goes, so watching is reading two files
// and printing what is new: what each seat decided, and what the seats said to
// each other. This is the view for watching organic diplomacy appear, rather
// than reconstructing it afterwards from a report.

import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { logger } from "../utils/logger.js";

// How often to look for new lines, in milliseconds.
const pollIntervalMs = 5000;

// How much of a file to read at a time, which is far more than a turn writes.
const readChunkBytes = 65536;

// Where a watched file has been read up to.
export interface TailPosition {
  // Bytes already consumed.
  offset: number;
  // Text left over from a partial line.
  remainder: string;
}

// Read whatever has been appended to a file since the last read, and hand back
// whole lines only, keeping any partial line for the next read.
export async function readNewLines(file: string, position: TailPosition): Promise<string[]> {
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return [];
  }
  if (size <= position.offset) return [];
  const handle = await open(file, "r");
  try {
    const length = Math.min(readChunkBytes, size - position.offset);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, position.offset);
    position.offset += length;
    const text = position.remainder + buffer.toString("utf8");
    const lines = text.split("\n");
    position.remainder = lines.pop() ?? "";
    return lines.filter((line) => line.trim().length > 0);
  } finally {
    await handle.close();
  }
}

// Print one thing a seat said.
function showMessage(line: string): void {
  try {
    const entry = JSON.parse(line) as { from?: string; kind?: string; to?: string; text?: string };
    const scope = entry.to === "world" || entry.to === undefined ? "to everyone" : "to " + entry.to;
    logger.info("[say] " + String(entry.from) + " " + scope + ": " + String(entry.text ?? ""));
  } catch {
    // A damaged line is skipped: watching must never stop on one bad line.
  }
}

// Print one turn a seat played.
function showTurn(line: string): void {
  try {
    const record = JSON.parse(line) as {
      seat?: string;
      turn?: number;
      outcome?: string;
      applied?: string;
      reasoning?: string | null;
      usage?: { cacheRead?: number; input?: number; cost?: number | null };
      contextReset?: boolean;
    };
    const usage = record.usage ?? {};
    const reset = record.contextReset ? " [session replaced]" : "";
    logger.info(
      "[turn] " +
        record.turn +
        " " +
        record.seat +
        " " +
        record.outcome +
        reset +
        " | " +
        String(record.applied ?? "") +
        " | cache " +
        String(usage.cacheRead ?? 0) +
        " uncached " +
        String(usage.input ?? 0) +
        " cost " +
        (typeof usage.cost === "number" ? usage.cost.toFixed(5) : "unknown")
    );
    const thought = (record.reasoning ?? "").replace(/\s+/g, " ").trim();
    if (thought.length > 0) logger.info("[think] " + (thought.length > 300 ? thought.slice(0, 297) + "..." : thought));
  } catch {
    // Same as above: one bad line never stops the watch.
  }
}

// Watch a run until the process is stopped.
async function watch(runDirectory: string): Promise<void> {
  logger.info("Watching " + runDirectory + ". New turns and messages appear as they are written.");
  const socialFile = path.join(runDirectory, "social", "social.jsonl");
  const socialPosition: TailPosition = { offset: 0, remainder: "" };
  const seatPositions = new Map<string, TailPosition>();
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    for (const line of await readNewLines(socialFile, socialPosition)) showMessage(line);
    const traceDirectory = path.join(runDirectory, "trace");
    let seats: string[] = [];
    try {
      seats = (await readdir(traceDirectory)).filter((name) => name.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const seat of seats) {
      const position = seatPositions.get(seat) ?? { offset: 0, remainder: "" };
      seatPositions.set(seat, position);
      for (const line of await readNewLines(path.join(traceDirectory, seat), position)) showTurn(line);
    }
  }
}

// Read the run directory from the command line.
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const named = args.find((arg) => !arg.startsWith("--"));
  const runsDirectory = path.join("opencode-harness", "runs");
  const runDirectory = named
    ? path.isAbsolute(named)
      ? named
      : path.join(runsDirectory, named)
    : runsDirectory;
  await watch(runDirectory);
}

if (process.argv[1] && process.argv[1].endsWith("watch-run.js")) {
  await main();
}
