// Summarises several runs of the same variant.
//
// One run of a variant is an anecdote. The same variant played on several seeds
// gives a spread, and only a difference larger than that spread means anything.
// This is what turns the tuning loop from impressions into a measurement.

import type { RunMeasures } from "./compare.js";

// One measure across several runs: what it ran at, and how far it moved.
export interface MeasureSpread {
  // The label a reader sees.
  label: string;
  // The mean across the runs.
  mean: number | null;
  // The lowest value seen, or null when the measure is not available.
  min: number | null;
  // The highest value seen.
  max: number | null;
  // How many runs reported a value at all.
  samples: number;
}

// One variant, played several times.
export interface VariantSummary {
  // A name for the variant, which is the run id prefix it was played under.
  variant: string;
  // The runs that make it up, in the order played.
  runIds: string[];
  // The measures, in the order a reader wants them.
  measures: MeasureSpread[];
  // The mean of each measure, keyed by label, for building a comparison.
  byLabel: Record<string, number | null>;
}

// The measures worth summarising, in the order they should be read. The order
// is fixed here so two variants always line up.
const measureRows: Array<{ label: string; read: (entry: RunMeasures) => number | null }> = [
  { label: "Social operations", read: (entry) => entry.operations },
  { label: "Direct messages", read: (entry) => entry.direct },
  { label: "World messages", read: (entry) => entry.world },
  { label: "Seats silent", read: (entry) => entry.silence },
  { label: "Turns with any social operation", read: (entry) => entry.turnsWithSocial },
  { label: "Longest silence, in turns", read: (entry) => entry.longestSilence },
  { label: "Direct messages answered in kind", read: (entry) => entry.directReplyRate },
  { label: "Cache hit ratio", read: (entry) => entry.cacheHitRatio },
  { label: "Uncached input per turn", read: (entry) => entry.inputPerTurn },
  { label: "Cost", read: (entry) => entry.totalCost },
  { label: "Cost per social operation", read: (entry) => entry.costPerSocialOperation },
  { label: "Substantive messages", read: (entry) => entry.substantiveRate },
  { label: "Messages naming another seat", read: (entry) => entry.personalisedRate },
  { label: "Messages that leaked the machinery", read: (entry) => entry.metaRate },
  { label: "Proposals", read: (entry) => entry.proposals },
  { label: "Repairs after harm", read: (entry) => entry.repairs },
  { label: "Turns that did not finish", read: (entry) => entry.unfinished }
];

// The mean and the range of one set of numbers.
function spreadOf(label: string, values: number[]): MeasureSpread {
  if (values.length === 0) return { label, mean: null, min: null, max: null, samples: 0 };
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    label,
    mean: total / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    samples: values.length
  };
}

// Summarise one variant from its runs.
export function summariseVariant(variant: string, runs: RunMeasures[]): VariantSummary {
  const measures = measureRows.map((row) => {
    const values: number[] = [];
    for (const run of runs) {
      const value = row.read(run);
      if (value !== null && Number.isFinite(value)) values.push(value);
    }
    return spreadOf(row.label, values);
  });
  const byLabel: Record<string, number | null> = {};
  for (const measure of measures) byLabel[measure.label] = measure.mean;
  return { variant, runIds: runs.map((run) => run.runId), measures, byLabel };
}

// One measure written the way a summary table wants it.
function asText(value: number | null): string {
  if (value === null) return "n/a";
  if (Number.isInteger(value)) return String(value);
  // A mean of whole things is worth two places, while a ratio or a cost needs
  // more. Trailing zeros are noise in a table a person reads either way.
  const places = Math.abs(value) >= 1 ? 2 : 4;
  return value.toFixed(places).replace(/0+$/, "").replace(/\.$/, "");
}

// Render one variant's spread.
function spreadText(measure: MeasureSpread): string {
  if (measure.samples === 0 || measure.mean === null) return "n/a";
  if (measure.min === measure.max) return asText(measure.mean);
  return asText(measure.mean) + " (" + asText(measure.min) + " to " + asText(measure.max) + ")";
}

// Render several variants side by side, each with its spread.
//
// This is the artifact a tuning decision is made from: a difference worth
// acting on has to be larger than the range the same variant produces on its
// own.
export function renderAggregate(summaries: VariantSummary[]): string {
  const lines: string[] = [];
  lines.push("# Variant comparison");
  lines.push("");
  if (summaries.length === 0) {
    lines.push("No runs to summarise.");
    return lines.join("\n");
  }
  const baseline = summaries[0];
  lines.push(
    summaries.length === 1
      ? "One variant, played " + baseline.runIds.length + " time(s)."
      : "Each column is one variant played several times. A difference smaller than the range in brackets is not a result."
  );
  lines.push("");
  lines.push("| Measure | " + summaries.map((summary) => summary.variant).join(" | ") + " |");
  lines.push("| --- |" + summaries.map(() => " --- |").join(""));
  for (const label of measureRows.map((row) => row.label)) {
    const cells = summaries.map((summary) => {
      const measure = summary.measures.find((entry) => entry.label === label);
      return measure ? spreadText(measure) : "n/a";
    });
    lines.push("| " + label + " | " + cells.join(" | ") + " |");
  }
  lines.push("");
  lines.push("Runs: " + summaries.map((summary) => summary.variant + " " + summary.runIds.join(", ")).join("; ") + ".");
  lines.push("");
  if (summaries.length > 1) {
    lines.push("## What stands out against " + baseline.variant);
    lines.push("");
    for (const summary of summaries.slice(1)) {
      const findings: string[] = [];
      for (const row of measureRows) {
        const before = baseline.measures.find((entry) => entry.label === row.label);
        const after = summary.measures.find((entry) => entry.label === row.label);
        if (!before || !after || before.mean === null || after.mean === null) continue;
        if (after.mean === before.mean) continue;
        // A difference only counts when the two ranges do not overlap, which
        // keeps a spread from being read as an effect.
        const separated =
          (before.max !== null && after.min !== null && after.min > before.max) ||
          (before.min !== null && after.max !== null && after.max < before.min);
        const direction = after.mean > before.mean ? "higher" : "lower";
        findings.push(
          row.label + " " + direction + (separated ? " (ranges do not overlap)" : " (ranges overlap, not a result)")
        );
      }
      lines.push("- " + summary.variant + ": " + (findings.length === 0 ? "nothing differs" : findings.join("; ")) + ".");
    }
    lines.push("");
  }
  return lines.join("\n");
}
