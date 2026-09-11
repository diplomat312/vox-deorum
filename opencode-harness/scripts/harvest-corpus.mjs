// harvest-corpus.mjs
//
// Turns the recorded fresh4 game transcripts into replayable JSONL fixtures.
// Everything is read straight from the git object store, so the recording branch
// never has to be checked out.
//
// Regenerate the fixtures with:
//   node opencode-harness/scripts/harvest-corpus.mjs

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Branch that holds the recording. Repoint this constant to harvest another run.
const sourceBranch = "origin/vox-deorum-opencode";

// Game label written into every record. It must match the label inside the transcripts.
const gameLabel = "fresh4";

// The four seats of the recorded game, in the order the summary table reports them.
const seats = ["austria", "iroquois", "korea", "siam"];

// Directory of the recording for one seat, relative to the repository root.
const runDirectory = (seat) => `experiments/opencode-civ-pilot/live/runs-fresh4-${seat}`;

// Transcript file name inside each seat directory.
const transcriptName = "transcript-live.md";

// Turn subsection headings we know about. Unknown headings are still parsed and kept.
const observationHeading = "Observation sent";
const toolCallsHeading = "Tool calls";
const modelTextHeading = "Model words";
const commitHeading = "Commit";

// Longest tool output we keep, counted in characters. Outputs are mostly raw JSON.
const outputLimit = 4000;

// Matches a turn heading such as: ## Korea live turn 12 (session ses_abc123)
const turnHeadingPattern =
  /^##\s+(?<civ>[A-Za-z][A-Za-z ]*?)\s+live turn\s+(?<turn>\d+)(?:\s+\(session\s+(?<session>\S+?)\))?\s*$/;

// Matches a subsection heading such as: ### Observation sent
const subsectionPattern = /^###\s+(?<name>.+?)\s*$/;

// Matches the game label the observation text declares, such as "(live game fresh4)".
const labelPattern = /TURN \d+ \(live game ([^)]+)\)/;

// Repository root, derived from this script's own location.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Directory that receives the generated fixtures.
const corpusDir = path.join(repoRoot, "opencode-harness", "corpus", "fresh4");

/**
 * Reads one file from the recording branch through git, without checking it out.
 * Throws a clear error when the path is missing from the branch.
 */
function readFromBranch(branchPath) {
  try {
    return execFileSync("git", ["show", `${sourceBranch}:${branchPath}`], {
      cwd: repoRoot,
      maxBuffer: 512 * 1024 * 1024,
    }).toString("utf8");
  } catch (error) {
    throw new Error(`Cannot read ${sourceBranch}:${branchPath} through git. ${error.message}`);
  }
}

/** Drops leading and trailing blank lines, leaving everything in between untouched. */
function trimBlankEdges(text) {
  const lines = text.split(/\r?\n/);
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start += 1;
  while (end > start && lines[end - 1].trim() === "") end -= 1;
  return lines.slice(start, end).join("\n");
}

/**
 * Splits a transcript into turn sections. Each section keeps its subsections by
 * heading name, so headings we do not model yet are still captured rather than lost.
 */
function splitTurns(rawText) {
  const turns = [];
  let current = null;
  let subsection = null;
  let buffer = [];

  const flushSubsection = () => {
    if (current && subsection) {
      const existing = current.subsections[subsection] ?? [];
      existing.push(buffer.join("\n"));
      current.subsections[subsection] = existing;
    }
    buffer = [];
    subsection = null;
  };

  const flushTurn = () => {
    flushSubsection();
    if (current) turns.push(current);
    current = null;
  };

  for (const line of rawText.split(/\r?\n/)) {
    const heading = line.match(turnHeadingPattern);
    if (heading) {
      flushTurn();
      current = {
        civ: heading.groups.civ,
        turn: Number(heading.groups.turn),
        session: heading.groups.session ?? null,
        subsections: {},
      };
      continue;
    }

    const sub = line.match(subsectionPattern);
    if (sub && current) {
      flushSubsection();
      subsection = sub.groups.name;
      continue;
    }

    if (current) buffer.push(line);
  }

  flushTurn();
  return turns;
}

/** Returns the first body recorded under a subsection heading, or an empty string. */
function firstSection(turn, name) {
  const bodies = turn.subsections[name];
  return bodies && bodies.length > 0 ? bodies[0] : "";
}

/** Reads the seat index out of the commit text when the JSON could not be parsed. */
function readPlayerID(commitText) {
  const match = commitText.match(/"playerID"\s*:\s*(\d+)/);
  return match ? Number(match[1]) : null;
}

/**
 * Infers the seat index and the decision for a turn from its Commit section.
 * A commit carries an actions array, a pass carries pass true. No section means none.
 */
function readCommit(turn) {
  const commitText = trimBlankEdges(firstSection(turn, commitHeading) ?? "");
  if (!commitText) return { playerID: null, decision: "none" };

  let parsed = null;
  try {
    parsed = JSON.parse(commitText);
  } catch {
    parsed = null;
  }

  const playerID = Number.isInteger(parsed?.playerID) ? parsed.playerID : readPlayerID(commitText);

  if (parsed && parsed.pass === true) return { playerID, decision: "pass" };
  if (parsed && Array.isArray(parsed.actions)) return { playerID, decision: "commit" };
  if (!parsed && /"pass"\s*:\s*true/.test(commitText)) return { playerID, decision: "pass" };
  if (!parsed && /"actions"\s*:/.test(commitText)) return { playerID, decision: "commit" };
  return { playerID, decision: "none" };
}

/** Normalises one recorded tool call into the fixture shape, trimming long output. */
function normalizeToolCall(call) {
  const rawOutput = call?.output;
  const output = typeof rawOutput === "string" ? rawOutput.slice(0, outputLimit) : rawOutput ?? null;
  return {
    tool: call?.tool ?? null,
    input: call?.input ?? null,
    output,
    error: call?.error ?? null,
    status: call?.status ?? null,
  };
}

/** Parses the Tool calls section of a turn. Throws when the recorded JSON is unreadable. */
function readToolCalls(turn) {
  const text = trimBlankEdges(firstSection(turn, toolCallsHeading) ?? "");
  if (!text) return [];

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Turn ${turn.turn} for ${turn.civ} has an unreadable Tool calls section. ${error.message}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Turn ${turn.turn} for ${turn.civ} has a Tool calls section that is not an array.`);
  }
  return parsed.map(normalizeToolCall);
}

/** Builds one fixture record from a parsed turn section. */
function buildRecord(seat, turn) {
  const observation = trimBlankEdges(firstSection(turn, observationHeading) ?? "");
  if (!observation) {
    throw new Error(
      `Turn ${turn.turn} for seat ${seat} has no "${observationHeading}" text. ` +
        `Refusing to write a fixture with an empty observation.`,
    );
  }

  const declaredLabel = observation.match(labelPattern)?.[1] ?? null;
  if (declaredLabel && declaredLabel !== gameLabel) {
    throw new Error(
      `Turn ${turn.turn} for seat ${seat} declares game "${declaredLabel}" but the script is set to "${gameLabel}".`,
    );
  }

  if (turn.civ.toLowerCase() !== seat) {
    throw new Error(`Turn ${turn.turn} heading says "${turn.civ}" but the seat directory says "${seat}".`);
  }

  const { playerID, decision } = readCommit(turn);
  const modelText = trimBlankEdges(firstSection(turn, modelTextHeading) ?? "");

  return {
    game: gameLabel,
    seat,
    playerID,
    turn: turn.turn,
    session: turn.session,
    observation,
    toolCalls: readToolCalls(turn),
    modelText: modelText || null,
    decision,
  };
}

/** Collects the per seat numbers the summary table prints. */
function summarize(seat, records) {
  const turns = records.map((record) => record.turn);
  return {
    seat,
    turns: records.length,
    min: turns.length > 0 ? Math.min(...turns) : null,
    max: turns.length > 0 ? Math.max(...turns) : null,
    commit: records.filter((record) => record.decision === "commit").length,
    pass: records.filter((record) => record.decision === "pass").length,
    none: records.filter((record) => record.decision === "none").length,
  };
}

/** Renders the summary rows as a simple aligned table. */
function renderTable(rows) {
  const columns = ["seat", "turns", "min", "max", "commit", "pass", "none"];
  const cells = rows.map((row) => columns.map((column) => String(row[column] ?? "")));
  const widths = columns.map((column, index) =>
    Math.max(column.length, ...cells.map((row) => row[index].length)),
  );
  const render = (row) => row.map((cell, index) => cell.padEnd(widths[index])).join("  ").trimEnd();

  return [render(columns), render(widths.map((width) => "-".repeat(width))), ...cells.map(render)].join("\n") + "\n";
}

/** Harvests every seat and writes one JSONL file per seat. */
function main() {
  mkdirSync(corpusDir, { recursive: true });
  const rows = [];

  for (const seat of seats) {
    const branchPath = `${runDirectory(seat)}/${transcriptName}`;
    const turns = splitTurns(readFromBranch(branchPath));
    if (turns.length === 0) {
      throw new Error(`No live turn sections found in ${branchPath}.`);
    }

    const records = turns.map((turn) => buildRecord(seat, turn));
    const jsonl = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
    writeFileSync(path.join(corpusDir, `${seat}.jsonl`), jsonl, "utf8");
    rows.push(summarize(seat, records));
  }

  process.stdout.write(renderTable(rows));
}

try {
  main();
} catch (error) {
  process.stderr.write(`harvest-corpus failed: ${error.message}\n`);
  process.exit(1);
}
