// Writes one seat's turn laid out in full, for reading what a model was given.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "../utils/logger.js";
import { renderTurn, pickTurn } from "./inspect-turn.js";
import { allTurns, readRun } from "./read-run.js";
import { resolveRunDirectory } from "./run-path.js";

// Write the turn the command line names.
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const named = args.filter((arg) => !arg.startsWith("--"));
  const [run, seat, turn] = named;
  if (!run) {
    logger.error("Name a run, and optionally a seat and a turn");
    process.exit(1);
  }
  const runDirectory = resolveRunDirectory(run);
  const data = await readRun(runDirectory);
  const records = allTurns(data);
  if (records.length === 0) {
    logger.error("Run " + data.runId + " recorded no turns");
    process.exit(1);
  }
  const wanted = {
    ...(seat === undefined ? {} : { seat }),
    ...(turn === undefined ? {} : { turn: Number(turn) })
  };
  const record = pickTurn(records, wanted);
  if (!record) {
    const seats = [...data.trace.keys()].sort().join(", ");
    logger.error("No such turn in " + data.runId + ". Seats: " + seats);
    process.exit(1);
  }
  const file = path.join(runDirectory, "turn-" + record.seat + "-" + record.turn + ".md");
  await writeFile(file, renderTurn(record), "utf8");
  logger.info("Wrote " + file);
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith("inspect-turn-run.js")) {
  await main().catch((error: unknown) => {
    logger.error("The turn could not be read: " + (error instanceof Error ? error.message : String(error)));
    process.exit(1);
  });
}
