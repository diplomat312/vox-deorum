// Compares finished runs from the console.
//
// Point it at two or more run directories, baseline first, and it prints the
// same measures side by side and writes the comparison beside the baseline.

import path from "node:path";
import { logger } from "../utils/logger.js";
import { compareRuns, renderComparison } from "./compare.js";
import { listRuns } from "./read-run.js";

// Compare the runs named on the command line, or every run under the runs
// directory when none are named, oldest first.
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const runsDirectoryAt = args.indexOf("--runs-dir");
  const runsDirectory = path.resolve(runsDirectoryAt === -1 ? path.join("opencode-harness", "runs") : args[runsDirectoryAt + 1]);
  // The value of --runs-dir is not a run name. When the flag is absent, nothing
  // is skipped, which is what keeps the first named run as the baseline.
  const named = args.filter((arg, index) => !arg.startsWith("--") && (runsDirectoryAt === -1 || index !== runsDirectoryAt + 1));
  const targets =
    named.length > 0
      ? named.map((name) => (path.isAbsolute(name) ? name : path.join(runsDirectory, name)))
      : (await listRuns(runsDirectory)).map((name) => path.join(runsDirectory, name));
  if (targets.length === 0) {
    logger.warn("No runs to compare under " + runsDirectory);
    process.exit(0);
  }
  const comparison = await compareRuns(targets);
  logger.info("\n" + renderComparison(comparison));
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith("compare-runs.js")) {
  await main();
}
