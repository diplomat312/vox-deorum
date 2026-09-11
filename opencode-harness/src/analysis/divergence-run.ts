// Writes the private-mind-against-public-word reading for one run.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "../utils/logger.js";
import { civDefinitions } from "../world/simulated/content.js";
import { buildDivergence, renderDivergence } from "./divergence.js";
import { allTurns, readRun } from "./read-run.js";
import { resolveRunDirectory } from "./run-path.js";

// Build the reading for one run directory.
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const named = args.find((arg) => !arg.startsWith("--"));
  if (!named) {
    logger.error("Name a run directory to read");
    process.exit(1);
  }
  const runDirectory = resolveRunDirectory(named);
  const data = await readRun(runDirectory);
  const seats = [...data.trace.keys()].sort();
  const titles: Record<string, string> = {};
  const parties = seats.map((seat) => {
    const known = civDefinitions.find((entry) => entry.seat === seat);
    if (known) titles[seat] = known.civ + " (" + known.leader + ")";
    return known
      ? { seat, display: known.civ, names: [seat, known.civ, known.leader] }
      : { seat, display: seat, names: [seat] };
  });
  const moments = buildDivergence(allTurns(data), parties);
  const markdown = renderDivergence(moments, data.runId, seats, titles);
  await writeFile(path.join(runDirectory, "divergence.md"), markdown, "utf8");
  const twoFaced = moments.filter((moment) => moment.kind === "two-faced").length;
  logger.info(
    "Private mind against public word for " +
      data.runId +
      ": " +
      moments.length +
      " reading(s), " +
      twoFaced +
      " with warm words over them"
  );
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith("divergence-run.js")) {
  await main().catch((error: unknown) => {
    logger.error("The reading could not continue: " + (error instanceof Error ? error.message : String(error)));
    process.exit(1);
  });
}
