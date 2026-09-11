// Compares whole variants from the summaries a matrix run left behind.
//
// One matrix run answers what a single variant does across seeds. This puts
// several of those together, so a tuning decision can be made from distributions
// rather than from one run of each.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { logger } from "../utils/logger.js";
import { renderAggregate, type VariantSummary } from "./aggregate.js";

// Read one matrix directory's summary.
async function loadVariant(directory: string): Promise<VariantSummary> {
  const file = path.join(directory, "aggregate.json");
  const parsed = JSON.parse(await readFile(file, "utf8")) as VariantSummary;
  if (typeof parsed.variant !== "string" || !Array.isArray(parsed.measures)) {
    throw new Error("The summary at " + file + " does not hold a variant and its measures");
  }
  return parsed;
}

// Compare the matrices named on the command line.
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const baseAt = args.indexOf("--dir");
  const base = path.resolve(baseAt === -1 ? path.join("opencode-harness", "matrix") : args[baseAt + 1]);
  const named = args.filter((arg, index) => !arg.startsWith("--") && index !== baseAt + 1);
  if (named.length === 0) {
    logger.warn("Name at least one matrix directory to compare");
    process.exit(0);
  }
  const summaries: VariantSummary[] = [];
  for (const name of named) {
    summaries.push(await loadVariant(path.isAbsolute(name) ? name : path.join(base, name)));
  }
  const report = renderAggregate(summaries);
  await writeFile(path.join(base, "variants.md"), report, "utf8");
  logger.info("\n" + report);
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith("compare-variants.js")) {
  await main().catch((error: unknown) => {
    logger.error("The comparison could not continue: " + (error instanceof Error ? error.message : String(error)));
    process.exit(1);
  });
}
