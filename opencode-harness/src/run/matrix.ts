// Plays one variant several times and reports what it did each time.
//
// A tuning question is answered by a distribution, not by one run. This plays
// the same variant on several seeds, aggregates the results, and says plainly
// which differences are larger than the variant's own spread.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { summariseVariant, renderAggregate } from "../analysis/aggregate.js";
import { measuresOf } from "../analysis/compare.js";
import { buildReport } from "../analysis/report.js";
import { logger } from "../utils/logger.js";
import { simulate, type SimulationOptions } from "./simulate.js";

// What a matrix run needs beyond one simulation.
export interface MatrixOptions extends Omit<SimulationOptions, "runId" | "runDirectory" | "seed" | "portBase"> {
  // Where every run of this matrix writes.
  matrixDirectory: string;
  // The seeds to play, one run each.
  seeds: number[];
  // A name for the variant, used as the run id prefix.
  variant: string;
  // The port to start allocating from.
  portBase: number;
  // How many ports to leave between runs, so concurrent leftovers cannot clash.
  portStride?: number;
  // When set, do not play anything. Summarise the runs already on disk, which
  // is how a summary is rebuilt after a measure is added without replaying the
  // games that produced it.
  reuse?: boolean;
}

// Play every seed and summarise what happened.
export async function runMatrix(options: MatrixOptions): Promise<string> {
  await mkdir(options.matrixDirectory, { recursive: true });
  const runs = [];
  for (let index = 0; index < options.seeds.length; index += 1) {
    const seed = options.seeds[index];
    const runId = options.variant + "-s" + seed;
    const runDirectory = path.join(options.matrixDirectory, runId);
    if (options.reuse) {
      runs.push(measuresOf(await buildReport(runDirectory)));
      logger.info("Summarised " + runId + " from disk");
      continue;
    }
    logger.info("Playing " + runId + " (seed " + seed + ", run " + (index + 1) + " of " + options.seeds.length + ")");
    await simulate({
      runDirectory,
      runId,
      seats: options.seats,
      fromTurn: options.fromTurn,
      toTurn: options.toTurn,
      seed,
      model: options.model,
      modelOverrides: options.modelOverrides,
      serverEntry: options.serverEntry,
      portBase: options.portBase + index * (options.portStride ?? 10),
      shocks: options.shocks,
      config: options.config,
      diplomacyBriefing: options.diplomacyBriefing,
      diplomacyCoaching: options.diplomacyCoaching,
      postureCoaching: options.postureCoaching,
      councilCoaching: options.councilCoaching,
      turnTimeoutMs: options.turnTimeoutMs
    });
    runs.push(measuresOf(await buildReport(runDirectory)));
  }
  const summary = summariseVariant(options.variant, runs);
  const report = renderAggregate([summary]);
  await writeFile(path.join(options.matrixDirectory, "aggregate.md"), report, "utf8");
  await writeFile(
    path.join(options.matrixDirectory, "aggregate.json"),
    JSON.stringify({ variant: summary.variant, runIds: summary.runIds, measures: summary.measures }, null, 2),
    "utf8"
  );
  logger.info("\n" + report);
  return report;
}

// Read the matrix from the command line and play it.
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (name: string, fallback?: string): string | undefined => {
    const at = args.indexOf("--" + name);
    return at === -1 ? fallback : args[at + 1];
  };
  const repositoryRoot = path.resolve(value("root", ".") as string);
  const variant = value("variant", "variant") as string;
  const seeds = ((value("seeds", "11") as string) || "")
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry));
  const matrixDirectory = path.resolve(
    value("dir", path.join(repositoryRoot, "opencode-harness/matrix", variant)) as string
  );
  const seats = ((value("seats", "korea,austria,siam,iroquois") as string) || "")
    .split(",")
    .map((seat) => seat.trim())
    .filter(Boolean);
  const modelSetting = (value("model", "opencode-go/deepseek-v4.1-flash") as string).split("/");
  const scenarioFile = value("scenario") as string | undefined;
  const shocks = scenarioFile ? await readScenario(repositoryRoot, scenarioFile) : [];

  await runMatrix({
    matrixDirectory,
    variant,
    seeds,
    seats,
    fromTurn: Number(value("from", "1")),
    toTurn: Number(value("to", "10")),
    model: { providerID: modelSetting[0], modelID: modelSetting.slice(1).join("/") },
    serverEntry: path.resolve(value("server", path.join(repositoryRoot, "opencode-harness/dist/mcp/seat-mcp.js")) as string),
    portBase: Number(value("port-base", "4900")),
    shocks,
    diplomacyCoaching: (value("coaching", "off") as string) === "on",
    diplomacyBriefing: (value("briefing", "off") as string) === "on",
    postureCoaching: (value("posture-coaching", "off") as string) === "on",
    councilCoaching: (value("council-coaching", "off") as string) === "on",
    turnTimeoutMs: Number(value("turn-timeout", "150000")),
    reuse: args.includes("--reuse")
  });
  process.exit(0);
}

// Read a scenario file, which lists the circumstances a run should inject.
async function readScenario(repositoryRoot: string, file: string): Promise<SimulationOptions["shocks"]> {
  const { readFile } = await import("node:fs/promises");
  const resolved = path.isAbsolute(file) ? file : path.join(repositoryRoot, file);
  const parsed: unknown = JSON.parse(await readFile(resolved, "utf8"));
  if (!Array.isArray(parsed)) throw new Error("A scenario file must hold an array of shocks");
  return parsed as SimulationOptions["shocks"];
}

if (process.argv[1] && process.argv[1].endsWith("matrix.js")) {
  await main().catch((error: unknown) => {
    logger.error("The matrix could not continue: " + (error instanceof Error ? error.message : String(error)));
    process.exit(1);
  });
}
