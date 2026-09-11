// Writes a roundup of what a run's seats were thinking.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "../utils/logger.js";
import { civDefinitions } from "../world/simulated/content.js";
import { allTurns, readRun } from "./read-run.js";
import { buildRoundup, renderRoundup } from "./roundup.js";
import { resolveRunDirectory } from "./run-path.js";

// Build the roundup for one run directory.
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const named = args.find((arg) => !arg.startsWith("--"));
  if (!named) {
    logger.error("Name a run directory to summarise");
    process.exit(1);
  }
  const runDirectory = resolveRunDirectory(named);
  const data = await readRun(runDirectory);
  const seats = [...data.trace.keys()].sort();
  const civ = civDefinitions.filter((entry) => seats.includes(entry.seat));
  const titles: Record<string, string> = {};
  for (const entry of civ) titles[entry.seat] = entry.civ + " (" + entry.leader + ")";
  // Every name a seat answers to, with the civilization as the name to show.
  const parties = seats.map((seat) => {
    const known = civ.find((entry) => entry.seat === seat);
    return known
      ? { seat, display: known.civ, names: [seat, known.civ, known.leader] }
      : { seat, display: seat, names: [seat] };
  });
  const moments = buildRoundup(allTurns(data), parties);
  const markdown = renderRoundup(moments, data.runId, seats, titles);
  await writeFile(path.join(runDirectory, "roundup.md"), markdown, "utf8");
  const counts = seats.map((seat) => seat + " " + moments.filter((moment) => moment.seat === seat).length);
  logger.info("Roundup for " + data.runId + ": " + moments.length + " moment(s) across " + counts.join(", "));
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith("roundup-run.js")) {
  await main().catch((error: unknown) => {
    logger.error("The roundup could not continue: " + (error instanceof Error ? error.message : String(error)));
    process.exit(1);
  });
}
