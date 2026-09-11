// Places several runs side by side.
//
// A hypothesis about diplomacy is only worth having if two runs can be compared
// without argument, so this puts the same measures in the same order for every
// run and lists what changed against the first one. The first run given is the
// baseline, because that is the one a variant is meant to be read against.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { buildReport, type RunReport } from "./report.js";

// One run's measures, flattened so a table can hold them.
export interface RunMeasures {
  // The run identifier.
  runId: string;
  // Seats at the table.
  seats: string[];
  // Seat turns recorded.
  turnsPlayed: number;
  // Social operations applied.
  operations: number;
  // Operations that were world messages.
  world: number;
  // Operations that were direct messages.
  direct: number;
  // Operations that were group messages.
  group: number;
  // Seats that sent nothing.
  silence: number;
  // Turns on which the table said anything at all.
  turnsWithSocial: number;
  // The longest stretch of turns with no social operation.
  longestSilence: number;
  // Share of direct messages whose pair exchanged messages both ways.
  directReplyRate: number;
  // How many pairs opened a private channel.
  activePairs: number;
  // The middle lifespan of a private channel, in minutes.
  medianPairMinutes: number;
  // Social operations the world refused.
  refusals: number;
  // Share of prompt tokens served from the cache.
  cacheHitRatio: number;
  // Uncached input tokens per turn.
  inputPerTurn: number;
  // Spend across the run.
  totalCost: number;
  // Spend per turn.
  costPerTurn: number;
  // Spend per social operation, or null when nobody spoke.
  costPerSocialOperation: number | null;
  // Turns a seat failed to finish.
  unfinished: number;
  // Times a seat session was replaced.
  contextResets: number;
  // The slowest single turn.
  slowestTurnMs: number;
}

// Several runs, with the first treated as the baseline.
export interface RunComparison {
  // The baseline run.
  baseline: string;
  // Every run's measures, in the order given.
  runs: RunMeasures[];
}

// Pull the table measures out of one report.
export function measuresOf(report: RunReport): RunMeasures {
  return {
    runId: report.runId,
    seats: report.seats,
    turnsPlayed: report.turnsPlayed,
    operations: report.diplomacy.operations,
    world: report.diplomacy.byKind.world ?? 0,
    direct: report.diplomacy.byKind.dm ?? 0,
    group: report.diplomacy.byKind["group-msg"] ?? 0,
    silence: report.diplomacy.seatsSilent.length,
    turnsWithSocial: report.diplomacy.turnsWithSocial,
    longestSilence: report.diplomacy.longestSilence,
    directReplyRate: report.diplomacy.directReplyRate,
    activePairs: report.diplomacy.activePairs,
    medianPairMinutes: report.diplomacy.medianPairMinutes,
    refusals: report.diplomacy.refusals,
    cacheHitRatio: report.cost.cacheHitRatio,
    inputPerTurn: report.cost.inputPerTurn,
    totalCost: report.cost.totalCost,
    costPerTurn: report.cost.costPerTurn,
    costPerSocialOperation: report.cost.costPerSocialOperation,
    unfinished: report.cost.unfinished,
    contextResets: report.cost.contextResets,
    slowestTurnMs: report.cost.slowestTurnMs
  };
}

// Compare runs by directory, with the first one as the baseline.
export async function compareRuns(runDirectories: string[]): Promise<RunComparison> {
  const runs: RunMeasures[] = [];
  for (const directory of runDirectories) {
    runs.push(measuresOf(await buildReport(directory)));
  }
  return { baseline: runs[0]?.runId ?? "none", runs };
}

// How one measure is written in a table.
function asText(value: number | null): string {
  if (value === null) return "n/a";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(4);
}

// The measures in the order a reader wants them, with the label of each.
const rows: Array<{ label: string; read: (entry: RunMeasures) => number | null }> = [
  { label: "Seat turns", read: (entry) => entry.turnsPlayed },
  { label: "Social operations", read: (entry) => entry.operations },
  { label: "World messages", read: (entry) => entry.world },
  { label: "Direct messages", read: (entry) => entry.direct },
  { label: "Group messages", read: (entry) => entry.group },
  { label: "Silent seats", read: (entry) => entry.silence },
  { label: "Turns with any social operation", read: (entry) => entry.turnsWithSocial },
  { label: "Longest silence, in turns", read: (entry) => entry.longestSilence },
  { label: "Direct messages answered in kind", read: (entry) => entry.directReplyRate },
  { label: "Private channels opened", read: (entry) => entry.activePairs },
  { label: "Median lifespan of a private channel", read: (entry) => entry.medianPairMinutes },
  { label: "Refused social operations", read: (entry) => entry.refusals },
  { label: "Cache hit ratio", read: (entry) => entry.cacheHitRatio },
  { label: "Uncached input per turn", read: (entry) => entry.inputPerTurn },
  { label: "Cost", read: (entry) => entry.totalCost },
  { label: "Cost per turn", read: (entry) => entry.costPerTurn },
  { label: "Cost per social operation", read: (entry) => entry.costPerSocialOperation },
  { label: "Turns that did not finish", read: (entry) => entry.unfinished },
  { label: "Session resets", read: (entry) => entry.contextResets },
  { label: "Slowest turn, in ms", read: (entry) => entry.slowestTurnMs }
];

// Render a comparison as markdown.
export function renderComparison(comparison: RunComparison): string {
  const lines: string[] = [];
  lines.push("# Run comparison");
  lines.push("");
  lines.push("Baseline is " + comparison.baseline + ". Every other column is read against it.");
  lines.push("");
  lines.push("| Measure | " + comparison.runs.map((run) => run.runId).join(" | ") + " |");
  lines.push("| --- |" + comparison.runs.map(() => " --- |").join(""));
  for (const row of rows) {
    const values = comparison.runs.map((run) => asText(row.read(run)));
    lines.push("| " + row.label + " | " + values.join(" | ") + " |");
  }
  lines.push("");
  lines.push("Seats: " + comparison.runs.map((run) => run.runId + " " + run.seats.join(", ")).join("; ") + ".");
  lines.push("");
  lines.push("## What changed against the baseline");
  lines.push("");
  const baseline = comparison.runs[0];
  for (const run of comparison.runs.slice(1)) {
    const changes: string[] = [];
    for (const row of rows) {
      const before = row.read(baseline);
      const after = row.read(run);
      if (before === null || after === null || before === after) continue;
      const direction = after > before ? "up" : "down";
      const share = before === 0 ? "from zero" : "(" + (after > before ? "+" : "") + (((after - before) / Math.abs(before)) * 100).toFixed(0) + "%)";
      changes.push(row.label + " " + direction + " " + share);
    }
    lines.push("- " + run.runId + ": " + (changes.length === 0 ? "nothing changed" : changes.join(", ")) + ".");
  }
  lines.push("");
  return lines.join("\n");
}

// Write a comparison of several runs beside the first of them.
export async function writeComparison(runDirectories: string[]): Promise<RunComparison> {
  const comparison = await compareRuns(runDirectories);
  const target = path.join(runDirectories[0], "comparison.md");
  await writeFile(target, renderComparison(comparison), "utf8");
  return comparison;
}
