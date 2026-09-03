// Single cognition opportunity: build observation -> append to the SAME
// OpenCode session -> require commit_turn/pass -> optional one retry nudge.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MockBackend } from "./vox-backend.mjs";
import { identityBlock, buildObservation, buildDiploAppend } from "./observation.mjs";
import { appendToSession, readCommit, clearCommit } from "./session-manager.mjs";
import { appendTelemetry } from "./telemetry.mjs";

import { spawnSync } from "node:child_process";

function scrubEnv() {
  const e = { ...process.env };
  delete e.OPENCODE_SERVER_PASSWORD;
  delete e.OPENCODE_SERVER_USERNAME;
  return e;
}

// Authoritative per-turn usage via `opencode export`: sums assistant-message
// tokens for messages appended since prevCount. Export works with stock env.
function exportUsageDelta(sessionId, prevCount) {
  const r = spawnSync("opencode", ["export", sessionId], { encoding: "utf8", env: scrubEnv(), maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) return null;
  let data;
  try { data = JSON.parse(r.stdout); } catch { return null; }
  const msgs = data.messages ?? [];
  const agg = { uncached: 0, read: 0, write: 0, output: 0, reasoning: 0 };
  for (const m of msgs.slice(prevCount)) {
    if (m?.info?.role !== "assistant") continue;
    const t = m.info.tokens ?? {};
    agg.uncached += t.input ?? 0;
    agg.read += t.cache?.read ?? 0;
    agg.write += t.cache?.write ?? 0;
    agg.output += t.output ?? 0;
    agg.reasoning += t.reasoning ?? 0;
  }
  return { ...agg, newCount: msgs.length };
}

const here = path.dirname(fileURLToPath(import.meta.url));
const pilotDir = path.resolve(here, "..");

function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? dflt) : dflt;
}

const civ = arg("civ", "Rome");
const leader = arg("leader", "Augustus Caesar");
const turn = Number(arg("turn", "1"));
const seq = Number(arg("seq", String(turn)));
const game = arg("game", "pilot-1");
let sessionId = arg("session", null);
const model = arg("model", "opencode-go/muse-spark-1.3-contributor");
const runDir = arg("rundir", path.join(pilotDir, "runs", "manual"));
const diploFrom = arg("diplo-from", null);
const diploMsg = arg("diplo-msg", null);

fs.mkdirSync(runDir, { recursive: true });
const commitFile = path.join(runDir, "last-commit.json");
// Must be set BEFORE spawning opencode so the MCP server child inherits it.
process.env.CIV_PILOT_COMMIT_FILE = commitFile;
clearCommit(commitFile);
const teleFile = path.join(runDir, "telemetry.jsonl");
const transFile = path.join(runDir, "transcript.md");
const stateFile = path.join(runDir, "civ-state.json");
let prevCount = 0;
try { prevCount = JSON.parse(fs.readFileSync(stateFile, "utf8")).messageCount ?? 0; } catch {}

const backend = new MockBackend();
const state = backend.stateFor(turn);
const outstanding = turn === 6 ? ["Egypt requested Open Borders (no deal tool in phase 1 - note stance in rationale)."] : [];
let observation = turn === 1
  ? `${identityBlock(civ, leader)}\n\n${buildObservation({ civ, leader, turn, state, outstanding })}`
  : buildObservation({ civ, leader, turn, state, outstanding });
if (diploFrom && diploMsg) {
  observation += `\n\n${buildDiploAppend({ from: diploFrom, turn, message: diploMsg, facts: [`Treasury: ${state.treasury}`, `Posture: ${state.posture}`] })}`;
}

const tot = { uncached: 0, read: 0, write: 0, output: 0, reasoning: 0, latency: 0 };
const allCalls = [];
function fold(r) {
  tot.uncached += r.uncached ?? 0; tot.read += r.read ?? 0; tot.write += r.write ?? 0;
  tot.output += r.output ?? 0; tot.reasoning += r.reasoning ?? 0; tot.latency += r.latencyMs ?? 0;
  for (const t of r.toolCalls) allCalls.push(t);
}

let res = await appendToSession({
  dir: pilotDir, sessionId, message: observation, model,
  title: `${civ} civ mind`, timeoutMs: 300000,
});
fold(res);
if (res.sessionId) sessionId = res.sessionId;
let commit = readCommit(commitFile);
let nudged = false;
if (!commit || (!commit.actions && !commit.pass)) {
  nudged = true;
  const nudge = `You have not committed this turn. Call commit_turn (or pass) now with your decision. Phase-1 action types: strategy|research|policy|posture|production_mode|keep_status_quo.`;
  const r2 = await appendToSession({ dir: pilotDir, sessionId, message: nudge, model, timeoutMs: 180000 });
  for (const t of r2.toolCalls) allCalls.push({ ...t, followup: true });
  tot.uncached += r2.uncached ?? 0; tot.read += r2.read ?? 0; tot.write += r2.write ?? 0;
  tot.output += r2.output ?? 0; tot.reasoning += r2.reasoning ?? 0; tot.latency += r2.latencyMs ?? 0;
  commit = readCommit(commitFile);
}

const usage = sessionId ? exportUsageDelta(sessionId, prevCount) : null;
if (usage) {
  tot.uncached = usage.uncached; tot.read = usage.read; tot.write = usage.write;
  tot.output = usage.output; tot.reasoning = usage.reasoning;
  fs.writeFileSync(stateFile, JSON.stringify({ messageCount: usage.newCount, sessionId }));
}
const tele = {
  game, civ, turn, seq, model, sessionId,
  uncached_input_tokens: tot.uncached,
  cache_read_input_tokens: tot.read,
  cache_write_input_tokens: tot.write,
  output_tokens: tot.output,
  reasoning_tokens: tot.reasoning,
  latency_ms: tot.latency,
  tool_calls: allCalls.map((t) => t.tool + (t.followup ? "+nudge" : "")),
  nudged,
  commit_ok: !!(commit && (commit.actions || commit.pass)),
  compaction: false,
};
appendTelemetry(teleFile, tele);
fs.appendFileSync(transFile,
  `\n\n## Turn ${turn} (seq ${seq}) - session ${sessionId}\n\n### Observation sent\n\n${observation}\n\n### Tool calls\n\n${JSON.stringify(allCalls, null, 2)}\n\n### Commit\n\n${JSON.stringify(commit, null, 2)}\n`);
console.log(JSON.stringify({ sessionId, commit_ok: tele.commit_ok, tool_calls: tele.tool_calls, nudged, usage: { uncached: tot.uncached, read: tot.read, write: tot.write, output: tot.output }, latency_ms: tot.latency }, null, 2));
