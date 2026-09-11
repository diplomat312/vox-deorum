// Writes the report for a finished run.
//
// This is the entry point a person uses after a run, and the one a comparison
// between two runs is built on: point it at a run directory and it writes
// report.md and report.json beside the trace.

import path from "node:path";
import { logger } from "../utils/logger.js";
import { listRuns } from "./read-run.js";
import { writeReport } from "./report.js";

// Report every run directory it is given, or every run under the runs
// directory when it is given none.
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (name: string): string | undefined => {
    const at = args.indexOf("--" + name);
    return at === -1 ? undefined : args[at + 1];
  };
  const runsDirectory = path.resolve(value("runs-dir") ?? path.join("opencode-harness", "runs"));
  const named = args.filter((arg) => !arg.startsWith("--") && arg !== value("runs-dir"));
  const targets =
    named.length > 0
      ? named.map((name) => (path.isAbsolute(name) ? name : path.join(runsDirectory, name)))
      : (await listRuns(runsDirectory)).map((name) => path.join(runsDirectory, name));
  if (targets.length === 0) {
    logger.warn("No runs found under " + runsDirectory);
    process.exit(0);
  }
  for (const target of targets) {
    const report = await writeReport(target);
    logger.info(
      "Report for " +
        report.runId +
        ": " +
        report.turnsPlayed +
        " seat turns, " +
        report.diplomacy.operations +
        " social operation(s), " +
        report.diplomacy.seatsSilent.length +
        " silent seat(s), cache hit " +
        Math.round(report.cost.cacheHitRatio * 100) +
        "%, cost " +
        report.cost.totalCost.toFixed(4)
    );
  }
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith("report-run.js")) {
  await main();
}
