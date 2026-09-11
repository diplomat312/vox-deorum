// Turns a finished run into something a person can read and compare.
//
// The report exists to answer the two questions the harness is built around.
// Did the seats actually talk to each other, and what did that talking cost.
// Everything here is derived from what the run recorded, so two runs that
// differ only in how a seat was informed can be placed side by side.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { addressesOf, directPairOf, type SocialEntry } from "../social/social-store.js";
import { qualityMetrics, type QualityMetrics } from "./quality.js";
import { effectivenessMetrics, type EffectivenessMetrics } from "./effectiveness.js";
import { readWorldSummary, type WorldSummary } from "./world-summary.js";
import { durabilityMetrics, type DurabilityMetrics } from "./durability.js";
import { allTurns, readRun, type RunData, type RunToolCall } from "./read-run.js";
import type { TraceRecord } from "../trace/types.js";

// How much diplomacy happened, and of what kind.
export interface DiplomacyMetrics {
  // Every social operation the seats applied.
  operations: number;
  // Operations by kind, for example world, dm, group-msg, invite or accept.
  byKind: Record<string, number>;
  // Seats that sent at least one operation.
  seatsThatSpoke: string[];
  // Seats that sent nothing at all.
  seatsSilent: string[];
  // Operations each seat authored.
  authored: Record<string, number>;
  // Messages each seat was the addressee of, for direct and group messages.
  addressed: Record<string, number>;
  // Direct message counts per unordered pair, written "a|b" in seat order.
  directPairs: Record<string, number>;
  // Pairs where both seats sent at least one direct message to the other.
  answeredPairs: string[];
  // Discouraged operations the seats attempted and the world refused.
  refusals: number;
  // Turns, table wide, on which at least one seat said something.
  turnsWithSocial: number;
  // The longest run of turns, table wide, with no social operation at all.
  longestSilence: number;
  // Share of direct messages that got a direct message back from the other seat
  // on the same turn or later. This is the simplest reading of whether talking
  // went anywhere.
  directReplyRate: number;
  // How many pairs of seats opened a private channel at all.
  activePairs: number;
  // For each pair, how long their correspondence stayed in use, in minutes,
  // measured from the first message to the last. This is the durability reading:
  // a channel used once is a courtesy, a channel still in use an hour later is a
  // relationship.
  pairMinutes: Record<string, number>;
  // The middle of those spans, which is the one number worth putting in a table.
  medianPairMinutes: number;
}

// One seat's share of the run's spend.
export interface SeatCost {
  // Turns the seat played.
  turns: number;
  // Tokens sent to the model.
  input: number;
  // Tokens produced as visible text.
  output: number;
  // Tokens spent thinking.
  reasoning: number;
  // Tokens served from the prompt cache.
  cacheRead: number;
  // Tokens written into the prompt cache.
  cacheWrite: number;
  // Spend, when the provider reported any.
  cost: number;
  // Median time one turn took, in milliseconds.
  medianLatencyMs: number;
}

// What the run cost.
export interface CostMetrics {
  // Per seat, in a stable seat order.
  perSeat: Record<string, SeatCost>;
  // Spend across the run.
  totalCost: number;
  // Share of input tokens that came from the prompt cache across the run. This
  // is the number a persistent session is supposed to move.
  cacheHitRatio: number;
  // Input tokens per turn, which falls as a session's cache warms.
  inputPerTurn: number;
  // Spend per turn.
  costPerTurn: number;
  // Spend per social operation, or null when nobody spoke.
  costPerSocialOperation: number | null;
  // The slowest single turn, in milliseconds.
  slowestTurnMs: number;
  // Turns a seat failed to finish, across the run.
  unfinished: number;
  // Turns at which a seat's session was replaced, so its history and cache
  // started again. A run with resets is still comparable, but the cache figures
  // after a reset are not a continuation of the ones before it.
  contextResets: number;
}

// The two measures together, plus the raw material for a roundup.
export interface RunReport {
  // The run identifier.
  runId: string;
  // The game played.
  game: string;
  // The harness build that played it, when the run recorded one.
  build: string | null;
  // Seats at the table, in a stable order.
  seats: string[];
  // Turns recorded across seats.
  turnsPlayed: number;
  // The turn span played.
  fromTurn: number;
  toTurn: number;
  // How much the seats talked.
  diplomacy: DiplomacyMetrics;
  // What the run cost.
  cost: CostMetrics;
  // Information the seats asked for and did not get, counted by subject.
  gaps: Record<string, number>;
  // What each seat did, turn by turn, for reading back.
  roundup: Array<{ seat: string; turn: number; thought: string; did: string }>;
  // What the messages actually did, as opposed to how many there were.
  quality: QualityMetrics;
  // Whether the talking became anything in the world.
  effectiveness: EffectivenessMetrics;
  // What the world recorded by the end, when the run left a snapshot.
  world: WorldSummary | null;
  // Whether any relationship lasted rather than merely happened.
  durability: DurabilityMetrics;
  // Actions the world did not take, with the reason it gave. Empty for a
  // generated world that took everything, and not for a live game, where
  // legality is the game's to decide.
  refusals: Array<{ seat: string; turn: number; type: string; reason: string }>;
}

// Pull the information gaps back out of a turn's applied line.
function gapsOf(record: TraceRecord): string[] {
  const marker = "information gaps: ";
  const applied = record.applied ?? "";
  const at = applied.indexOf(marker);
  if (at === -1) return [];
  return applied
    .slice(at + marker.length)
    .split(", ")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

// The first sentence of a seat's thinking, which is the line a reader scans.
function headline(record: TraceRecord): string {
  const source = record.reasoning ?? record.modelText ?? "";
  const cleaned = source.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) return "(no thinking recorded)";
  const stop = cleaned.search(/\.\s/);
  const first = stop === -1 ? cleaned : cleaned.slice(0, stop + 1);
  return first.length > 220 ? first.slice(0, 217) + "..." : first;
}

// What a seat did this turn, in one short line.
function actionSummary(record: TraceRecord): string {
  if (record.outcome === "failed") return "failed: " + (record.error ?? "unknown error");
  if (record.outcome === "unfinished") return "did not decide";
  const applied = record.applied ?? "";
  if (applied.startsWith("nothing applied")) return record.outcome === "passed" ? "passed" : "nothing applied";
  return applied;
}

// Count how often each seat is addressed by a message.
function countAddressed(social: SocialEntry[], seats: string[]): Record<string, number> {
  const addressed: Record<string, number> = {};
  for (const seat of seats) addressed[seat] = 0;
  for (const entry of social) {
    for (const seat of addressesOf(entry)) {
      if (addressed[seat] !== undefined) addressed[seat] += 1;
    }
  }
  return addressed;
}

// Count direct messages per unordered pair, and work out which pairs answered.
function directPairs(social: SocialEntry[]): {
  counts: Record<string, number>;
  answered: string[];
  minutes: Record<string, number>;
} {
  const counts: Record<string, number> = {};
  const directions = new Map<string, Set<string>>();
  const firstAt = new Map<string, number>();
  const lastAt = new Map<string, number>();
  for (const entry of social) {
    const pair = directPairOf(entry);
    if (pair.length !== 2) continue;
    const key = pair.join("|");
    counts[key] = (counts[key] ?? 0) + 1;
    const pairDirections = directions.get(key) ?? new Set<string>();
    pairDirections.add(entry.from);
    directions.set(key, pairDirections);
    const at = Date.parse(entry.at);
    if (Number.isFinite(at)) {
      firstAt.set(key, Math.min(firstAt.get(key) ?? at, at));
      lastAt.set(key, Math.max(lastAt.get(key) ?? at, at));
    }
  }
  const answered = [...directions.entries()].filter(([, senders]) => senders.size > 1).map(([key]) => key);
  const minutes: Record<string, number> = {};
  for (const key of Object.keys(counts)) {
    const from = firstAt.get(key);
    const to = lastAt.get(key);
    if (from === undefined || to === undefined) continue;
    minutes[key] = Math.round((to - from) / 60000);
  }
  return { counts, answered, minutes };
}

// Work out the diplomacy metrics from the social log and the trace.
export function diplomacyMetrics(data: RunData, seats: string[]): DiplomacyMetrics {
  const social = data.social;
  const authored: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  for (const seat of seats) authored[seat] = 0;
  for (const entry of social) {
    authored[entry.from] = (authored[entry.from] ?? 0) + 1;
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
  }
  const pairs = directPairs(social);
  const directMessages = social.filter((entry) => entry.kind === "dm");
  // A direct message counts as answered in kind when its pair saw traffic in
  // both directions, which is the plainest reading of whether talking went
  // anywhere.
  const answeredDirect = directMessages.filter((entry) => {
    const pair = directPairOf(entry).join("|");
    return pairs.answered.includes(pair);
  }).length;

  // Turns on which the table was silent, for the longest stretch of quiet.
  const turnsPlayed = [...new Set(allTurns(data).map((record) => record.turn))].sort((left, right) => left - right);
  const speakingTurns = new Set<number>();
  for (const record of allTurns(data)) {
    if (record.toolCalls.some((call) => call.tool.replace(/^vox-civ_/, "") === "communicate")) {
      speakingTurns.add(record.turn);
    }
  }
  let longestSilence = 0;
  let current = 0;
  for (const turn of turnsPlayed) {
    if (speakingTurns.has(turn)) {
      current = 0;
    } else {
      current += 1;
      longestSilence = Math.max(longestSilence, current);
    }
  }

  const refusals = data.toolCalls.filter(
    (call) => call.tool.replace(/^vox-civ_/, "") === "communicate" && call.result.includes("refused")
  ).length;
  const pairSpans = Object.values(pairs.minutes);

  return {
    operations: social.length,
    byKind,
    seatsThatSpoke: seats.filter((seat) => (authored[seat] ?? 0) > 0),
    seatsSilent: seats.filter((seat) => (authored[seat] ?? 0) === 0),
    authored,
    addressed: countAddressed(social, seats),
    directPairs: pairs.counts,
    answeredPairs: pairs.answered,
    refusals,
    turnsWithSocial: speakingTurns.size,
    longestSilence,
    directReplyRate: directMessages.length === 0 ? 0 : answeredDirect / directMessages.length,
    activePairs: Object.keys(pairs.counts).length,
    pairMinutes: pairs.minutes,
    medianPairMinutes: pairSpans.length === 0 ? 0 : median(pairSpans)
  };
}

// The middle of a list of numbers, which is steadier than the mean when one
// turn ran long.
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
}

// Work out the cost metrics from the trace.
export function costMetrics(data: RunData, seats: string[]): CostMetrics {
  const turns = allTurns(data);
  const perSeat: Record<string, SeatCost> = {};
  let input = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;
  let slowest = 0;
  let unfinished = 0;
  let contextResets = 0;
  for (const seat of seats) {
    const records = data.trace.get(seat) ?? [];
    const seatInput = records.reduce((sum, record) => sum + record.usage.input, 0);
    const seatCacheRead = records.reduce((sum, record) => sum + record.usage.cacheRead, 0);
    perSeat[seat] = {
      turns: records.length,
      input: seatInput,
      output: records.reduce((sum, record) => sum + record.usage.output, 0),
      reasoning: records.reduce((sum, record) => sum + record.usage.reasoning, 0),
      cacheRead: seatCacheRead,
      cacheWrite: records.reduce((sum, record) => sum + record.usage.cacheWrite, 0),
      cost: records.reduce((sum, record) => sum + (record.usage.cost ?? 0), 0),
      medianLatencyMs: median(records.map((record) => record.latencyMs))
    };
    input += seatInput;
    cacheRead += seatCacheRead;
    cacheWrite += records.reduce((sum, record) => sum + record.usage.cacheWrite, 0);
    cost += records.reduce((sum, record) => sum + (record.usage.cost ?? 0), 0);
    slowest = Math.max(slowest, ...records.map((record) => record.latencyMs));
    unfinished += records.filter((record) => record.outcome === "failed" || record.outcome === "unfinished").length;
    contextResets += records.filter((record) => record.contextReset === true).length;
  }
  const socialOperations = data.social.length;
  const promptTokens = input + cacheRead + cacheWrite;
  return {
    perSeat,
    totalCost: cost,
    cacheHitRatio: promptTokens === 0 ? 0 : cacheRead / promptTokens,
    inputPerTurn: turns.length === 0 ? 0 : Math.round(input / turns.length),
    costPerTurn: turns.length === 0 ? 0 : cost / turns.length,
    costPerSocialOperation: socialOperations === 0 ? null : cost / socialOperations,
    slowestTurnMs: slowest,
    unfinished,
    contextResets
  };
}

// Build the whole report for a run.
export async function buildReport(runDirectory: string): Promise<RunReport> {
  const data = await readRun(runDirectory);
  const seats = [...data.trace.keys()].sort();
  const turns = allTurns(data);
  const gaps: Record<string, number> = {};
  for (const record of turns) {
    for (const gap of gapsOf(record)) gaps[gap] = (gaps[gap] ?? 0) + 1;
  }
  return {
    runId: data.runId,
    game: data.game,
    build: data.build,
    seats,
    turnsPlayed: turns.length,
    fromTurn: turns.length === 0 ? 0 : turns[0].turn,
    toTurn: turns.length === 0 ? 0 : turns[turns.length - 1].turn,
    diplomacy: diplomacyMetrics(data, seats),
    cost: costMetrics(data, seats),
    gaps,
    quality: qualityMetrics(data.social, seats),
    effectiveness: effectivenessMetrics(turns, seats),
    world: await readWorldSummary(runDirectory),
    durability: durabilityMetrics(turns, data.social),
    refusals: turns.flatMap((record) =>
      (record.refused ?? []).map((entry) => ({
        seat: record.seat,
        turn: record.turn,
        type: entry.type,
        reason: entry.reason
      }))
    ),
    roundup: turns.map((record) => ({
      seat: record.seat,
      turn: record.turn,
      thought: headline(record),
      did: actionSummary(record)
    }))
  };
}

// How many times each tool was called, by its harness name.
export function toolCallCounts(toolCalls: RunToolCall[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const call of toolCalls) {
    const name = call.tool.replace(/^vox-civ_/, "");
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

// Render a report as markdown, which is what a person reads and what a run
// keeps beside its trace.
export function renderReport(report: RunReport, toolCalls: RunToolCall[]): string {
  const lines: string[] = [];
  const diplomacy = report.diplomacy;
  const cost = report.cost;
  lines.push("# Run " + report.runId);
  lines.push("");
  lines.push(
    "Game " +
      report.game +
      ", seats " +
      report.seats.join(", ") +
      ", turns " +
      report.fromTurn +
      " to " +
      report.toTurn +
      " (" +
      report.turnsPlayed +
      " seat turns)."
  );
  if (report.build) {
    // A run whose build is known can be compared with another; the same numbers
    // from a different build are evidence of a change rather than of a variant.
    lines.push("");
    lines.push("Played on harness build " + report.build + ".");
  }
  lines.push("");
  lines.push("## Diplomacy");
  lines.push("");
  lines.push("| Measure | Value |");
  lines.push("| --- | --- |");
  lines.push("| Social operations | " + diplomacy.operations + " |");
  lines.push("| Seats that spoke | " + (diplomacy.seatsThatSpoke.join(", ") || "none") + " |");
  lines.push("| Seats silent | " + (diplomacy.seatsSilent.join(", ") || "none") + " |");
  lines.push("| Turns with any social operation | " + diplomacy.turnsWithSocial + " |");
  lines.push("| Longest silence, in turns | " + diplomacy.longestSilence + " |");
  lines.push("| Direct messages | " + (diplomacy.byKind.dm ?? 0) + " |");
  lines.push("| World messages | " + (diplomacy.byKind.world ?? 0) + " |");
  lines.push("| Group messages | " + (diplomacy.byKind["group-msg"] ?? 0) + " |");
  lines.push("| Groups created | " + (diplomacy.byKind["group-create"] ?? 0) + " |");
  lines.push("| Refused social operations | " + diplomacy.refusals + " |");
  lines.push("| Direct messages answered in kind | " + Math.round(diplomacy.directReplyRate * 100) + "% |");
  lines.push("| Private channels opened | " + diplomacy.activePairs + " |");
  lines.push("| Median lifespan of a private channel | " + diplomacy.medianPairMinutes + " minutes |");
  lines.push("| Pairs that spoke on more than one turn | " + report.durability.sustainedPairs + " |");
  lines.push("| Pairs still in contact at the end | " + report.durability.pairsStillActiveAtEnd + " |");
  lines.push("| Median span of a private channel | " + report.durability.medianSpan + " turns |");
  lines.push("| Median turn coverage of a channel | " + Math.round(report.durability.medianCoverage * 100) + "% |");
  lines.push("");
  if (Object.keys(diplomacy.authored).length > 0) {
    lines.push("Operations authored by seat: " + Object.entries(diplomacy.authored).map(([seat, count]) => seat + " " + count).join(", ") + ".");
    lines.push("");
  }
  if (Object.keys(diplomacy.addressed).length > 0) {
    lines.push(
      "Messages addressed to a seat: " +
        Object.entries(diplomacy.addressed)
          .map(([seat, count]) => seat + " " + count)
          .join(", ") +
        "."
    );
    lines.push("");
  }
  if (Object.keys(diplomacy.directPairs).length > 0) {
    lines.push(
      "Direct message pairs: " +
        Object.entries(diplomacy.directPairs)
          .map(([pair, count]) => pair.replace("|", " and ") + " " + count)
          .join(", ") +
        "."
    );
    lines.push("");
  }
  lines.push("## What the talking changed");
  if (report.world) {
    lines.push("## What the world recorded");
    lines.push("");
    lines.push("| Measure | Value |");
    lines.push("| --- | --- |");
    lines.push("| Deals agreed and carried out | " + report.world.settledDeals + " |");
    lines.push("| Promises still being paid | " + report.world.tributeInForce.length + " |");
    lines.push("| Promises broken | " + report.world.brokenPromises + " |");
    lines.push("| Wars declared | " + report.world.wars.length + " |");
    lines.push("");
    if (report.world.coldest) {
      const cold = report.world.coldest;
      lines.push(
        "Coldest regard at turn " +
          report.world.turn +
          ": " +
          cold.from +
          " holds a private regard of " +
          cold.privateValue +
          " toward " +
          cold.to +
          (cold.atWar ? ", and they are at war." : ".")
      );
    } else {
      lines.push("No seat held a negative private regard toward another by the end.");
    }
    lines.push("");
  }
  lines.push("");
  const actionKinds = Object.entries(report.effectiveness.byType)
    .sort((left, right) => right[1] - left[1])
    .map(([type, count]) => type + " " + count)
    .join(", ");
  lines.push("| Measure | Value |");
  lines.push("| --- | --- |");
  lines.push("| Posture changes, which are diplomacy as a game action | " + report.effectiveness.postures + " |");
  lines.push("| Turns on which a seat changed its regard for someone | " + report.effectiveness.turnsWithPosture + " |");
  lines.push("| Seats that never set a posture | " + (report.effectiveness.seatsWithoutPosture.join(", ") || "none") + " |");
  lines.push("| Share of seat turns that changed something lasting | " + Math.round(report.effectiveness.actionRate * 100) + "% |");
  lines.push("");
  lines.push("Actions committed: " + (actionKinds || "none") + ".");
  lines.push(
    "Actions the world did not take: " +
      (report.refusals.length === 0
        ? "none"
        : report.refusals
            .map((entry) => entry.seat + " turn " + entry.turn + " " + entry.type + " (" + entry.reason + ")")
            .join("; "))
  );
  lines.push("");
  lines.push("## What the messages did");
  lines.push("");
  lines.push("| Move | Messages |");
  lines.push("| --- | --- |");
  for (const [move, count] of Object.entries(report.quality.byMove)) {
    lines.push("| " + move + " | " + count + " |");
  }
  lines.push("");
  lines.push(
    "Substantive messages (anything beyond courtesy) " +
      Math.round(report.quality.substantiveRate * 100) +
      "%, messages naming another seat " +
      Math.round(report.quality.personalisedRate * 100) +
      "%, messages that leaked the machinery " +
      Math.round(report.quality.metaRate * 100) +
      "%."
  );
  lines.push("");
  lines.push("## What it cost");
  lines.push("");
  lines.push("| Seat | Turns | Input | Cache read | Cache write | Output | Reasoning | Cost | Median turn |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const seat of report.seats) {
    const entry = cost.perSeat[seat];
    lines.push(
      "| " +
        seat +
        " | " +
        entry.turns +
        " | " +
        entry.input +
        " | " +
        entry.cacheRead +
        " | " +
        entry.cacheWrite +
        " | " +
        entry.output +
        " | " +
        entry.reasoning +
        " | " +
        entry.cost.toFixed(4) +
        " | " +
        entry.medianLatencyMs +
        " ms |"
    );
  }
  lines.push("");
  lines.push(
    "Cache hit ratio " +
      Math.round(cost.cacheHitRatio * 100) +
      "%. Uncached input per turn " +
      cost.inputPerTurn +
      " tokens. Cost per turn " +
      cost.costPerTurn.toFixed(4) +
      ". Slowest turn " +
      cost.slowestTurnMs +
      " ms. Turns that did not finish " +
      cost.unfinished +
      "." +
      (cost.contextResets > 0
        ? " A seat's session was replaced " + cost.contextResets + " time(s), so its context started again from there."
        : "")
  );
  lines.push("");
  lines.push(
    cost.costPerSocialOperation === null
      ? "No seat spoke, so there is no cost per social operation to report."
      : "Cost per social operation " + cost.costPerSocialOperation.toFixed(4) + "."
  );
  lines.push("");
  const counts = toolCallCounts(toolCalls);
  lines.push(
    "Tools called: " +
      Object.entries(counts)
        .map(([name, count]) => name + " " + count)
        .join(", ") +
      "."
  );
  lines.push("");
  if (Object.keys(report.gaps).length > 0) {
    lines.push("## Information the seats asked for and did not get");
    lines.push("");
    for (const [subject, count] of Object.entries(report.gaps).sort((left, right) => right[1] - left[1])) {
      lines.push("- " + subject + ": " + count);
    }
    lines.push("");
  }
  lines.push("## Roundup");
  lines.push("");
  lines.push("What each seat thought and did, turn by turn.");
  lines.push("");
  for (const entry of report.roundup) {
    lines.push("- **turn " + entry.turn + ", " + entry.seat + "** " + entry.did);
    lines.push("  - " + entry.thought);
  }
  lines.push("");
  return lines.join("\n");
}

// Write a run's report beside its trace.
export async function writeReport(runDirectory: string): Promise<RunReport> {
  const report = await buildReport(runDirectory);
  const data = await readRun(runDirectory);
  await writeFile(path.join(runDirectory, "report.md"), renderReport(report, data.toolCalls), "utf8");
  await writeFile(path.join(runDirectory, "report.json"), JSON.stringify(report, null, 2), "utf8");
  return report;
}
