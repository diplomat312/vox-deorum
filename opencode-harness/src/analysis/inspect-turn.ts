// One seat's turn, laid out in full, for reading what a model was actually given.
//
// Every measure in this directory reduces a run to numbers. This does the
// opposite for a single turn: the observation exactly as it was sent, what the
// seat thought, every call it made with its arguments and its answer, what the
// world did with what it asked for, what it asked for and never got, and what
// the turn cost. It is the view to read when asking whether the observation is
// carrying the right information, because it shows the distance between what a
// seat was shown and what it did with it.
//
// The observation is reproduced verbatim and never summarised. A reader who
// wants to know what a model saw should be able to read exactly that.

import type { TraceRecord } from "../trace/types.js";

// A fenced block, so the indentation of the code below stays readable.
const fence = String.fromCharCode(96).repeat(3);

// Render one turn as markdown.
export function renderTurn(record: TraceRecord): string {
  const lines: string[] = [];
  lines.push("# Turn " + record.turn + ", " + record.seat + ", run " + record.runId);
  lines.push("");
  lines.push(
    "Outcome **" +
      record.outcome +
      "**, thought for " +
      record.latencyMs +
      "ms" +
      (record.applied ? ", applied: " + record.applied : "") +
      (record.contextReset ? ", on a replaced session" : "") +
      (record.emptyRetries ? ", asked again " + record.emptyRetries + " time(s) after an empty answer" : "") +
      "."
  );
  lines.push("");
  lines.push(
    "Cost: in " +
      record.usage.input +
      ", out " +
      record.usage.output +
      ", reasoning " +
      record.usage.reasoning +
      ", cache read " +
      record.usage.cacheRead +
      ", cache write " +
      record.usage.cacheWrite +
      ", total " +
      record.usage.total +
      (record.usage.cost === null ? "" : ", spend " + record.usage.cost) +
      "."
  );
  if (record.error) {
    lines.push("");
    lines.push("**The turn ended in an error:** " + record.error);
  }
  if (record.refused.length > 0) {
    lines.push("");
    lines.push("## What the world would not do");
    lines.push("");
    for (const refusal of record.refused) lines.push("- " + refusal.type + ": " + refusal.reason);
  }
  lines.push("");
  lines.push("## What the seat was shown");
  lines.push("");
  lines.push(fence);
  lines.push(record.observation.trimEnd());
  lines.push(fence);
  lines.push("");
  lines.push("## What the seat thought");
  lines.push("");
  lines.push(record.reasoning === null || record.reasoning.trim() === "" ? "_No thinking was recorded._" : record.reasoning.trimEnd());
  lines.push("");
  lines.push("## What the seat called");
  lines.push("");
  if (record.toolCalls.length === 0) {
    lines.push("_No tool was called._");
    lines.push("");
  } else {
    for (const call of record.toolCalls) {
      lines.push("### " + call.tool + (call.status ? " (" + call.status + ")" : ""));
      lines.push("");
      lines.push("Arguments:");
      lines.push("");
      lines.push(fence + "json");
      lines.push(JSON.stringify(call.input ?? null, null, 2));
      lines.push(fence);
      lines.push("");
      lines.push("Answered:");
      lines.push("");
      lines.push(fence);
      lines.push((call.error ? "refused: " + call.error : call.output ?? "").trimEnd() || "_nothing_");
      lines.push(fence);
      lines.push("");
    }
  }
  if (record.modelText !== null && record.modelText.trim() !== "") {
    lines.push("## What the seat said to the table");
    lines.push("");
    lines.push(record.modelText.trimEnd());
    lines.push("");
  }
  if (record.unknownParts.length > 0) {
    lines.push("## Parts the reader did not recognise");
    lines.push("");
    lines.push("Kept so nothing disappears: " + record.unknownParts.join(", "));
    lines.push("");
  }
  return lines.join("\n");
}

// Pick the turn to show from what the reader asked for.
//
// A seat and a turn are both optional, because the useful questions differ: "what
// did Korea do on turn 9", "what did Korea do at all", and "what happened on turn
// 9". The last turn a seat took is the default, because it is the one a reader
// watching a run in progress wants.
export function pickTurn(
  records: TraceRecord[],
  wanted: { seat?: string; turn?: number }
): TraceRecord | null {
  let candidates = [...records];
  if (wanted.seat !== undefined) candidates = candidates.filter((record) => record.seat === wanted.seat);
  if (wanted.turn !== undefined) candidates = candidates.filter((record) => record.turn === wanted.turn);
  if (candidates.length === 0) return null;
  return candidates.sort((left, right) => left.turn - right.turn || left.seat.localeCompare(right.seat))[candidates.length - 1];
}

