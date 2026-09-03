// One cognition opportunity for the HARNESS civ (Rome) in the 2-player game.
// Reads shared world.json, appends to Rome's ONE persistent session, records
// the commit back into the world, advances the barrier when both moved.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorld, saveWorld, recordCommit, maybeAdvance, nextUp, buildPlayerObservation } from "./world.mjs";
import { appendToSession, readCommit, clearCommit } from "./session-manager.mjs";
import { appendTelemetry, exportUsageDelta } from "./telemetry.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pilotDir = path.resolve(here, "..");

function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? dflt) : dflt;
}

const rundir = path.resolve(pilotDir, arg("rundir", "runs/2p-game"));
const civ = arg("civ", "Rome");
const model = arg("model", "opencode-go/muse-spark-1.3-contributor");
let sessionId = arg("session", null);

const w = loadWorld(rundir);
const turnStarted = w.turn;
const observation = buildPlayerObservation(civ, w);

const commitFile = path.join(rundir, `last-commit-${civ}.json`);
process.env.CIV_PILOT_COMMIT_FILE = commitFile;
process.env.CIV_PILOT_WORLD_FILE = path.join(rundir, "world.json");
process.env.CIV_PILOT_CIV = civ;
process.env.ALLOW_DIPLOMACY = "1";
clearCommit(commitFile);
try { fs.unlinkSync(commitFile + ".messages.jsonl"); } catch {}

const stateFile = path.join(rundir, `civ-state-${civ}.json`);
let prevCount = 0;
try {
  const st = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  prevCount = st.messageCount ?? 0;
  if (!sessionId) sessionId = st.sessionId ?? null;
} catch {}

const tot = { uncached: 0, read: 0, write: 0, output: 0, reasoning: 0, latency: 0 };
const allCalls = [];
let res = await appendToSession({ dir: pilotDir, sessionId, message: observation, model, title: `${civ} civ mind (2p)`, timeoutMs: 300000 });
tot.latency += res.latencyMs ?? 0;
for (const t of res.toolCalls) allCalls.push(t);
if (res.sessionId) sessionId = res.sessionId;
let commit = readCommit(commitFile);
let nudged = false;
if (!commit || (!commit.actions && !commit.pass)) {
  nudged = true;
  const r2 = await appendToSession({ dir: pilotDir, sessionId, message: "You have not committed this turn. Call commit_turn (or pass) now.", model, timeoutMs: 180000 });
  for (const t of r2.toolCalls) allCalls.push({ ...t, followup: true });
  tot.latency += r2.latencyMs ?? 0;
  commit = readCommit(commitFile);
}

let advanced = false;
let commitOk = false;
if (commit && (commit.actions || commit.pass)) {
  commitOk = true;
  const w2 = loadWorld(rundir);
  recordCommit(w2, civ, commit);
  advanced = maybeAdvance(w2);
  saveWorld(rundir, w2);
}

const usage = sessionId ? exportUsageDelta(sessionId, prevCount) : null;
if (usage) {
  tot.uncached = usage.uncached; tot.read = usage.read; tot.write = usage.write;
  tot.output = usage.output; tot.reasoning = usage.reasoning;
  fs.writeFileSync(stateFile, JSON.stringify({ messageCount: usage.newCount, sessionId }));
}

const tele = {
  game: "2p-1", civ, turn: turnStarted, seq: turnStarted, model, sessionId,
  uncached_input_tokens: tot.uncached, cache_read_input_tokens: tot.read,
  cache_write_input_tokens: tot.write, output_tokens: tot.output,
  reasoning_tokens: tot.reasoning, latency_ms: tot.latency,
  tool_calls: allCalls.map((t) => t.tool + (t.followup ? "+nudge" : "")),
  nudged, commit_ok: commitOk, advanced, compaction: false,
};
appendTelemetry(path.join(rundir, "telemetry-2p.jsonl"), tele);
const w3 = loadWorld(rundir);
fs.appendFileSync(path.join(rundir, "transcript-2p.md"),
  `\n\n## ${civ} turn ${turnStarted} (session ${sessionId})\n\n### Observation sent\n\n${observation}\n\n### Tool calls\n\n${JSON.stringify(allCalls, null, 2)}\n\n### Commit\n\n${JSON.stringify(commit, null, 2)}\n\nWorld advanced: ${advanced}. Next up: ${nextUp(w3) ?? "turn " + w3.turn + " (both moved)"}.\n`);
console.log(JSON.stringify({ civ, turn: turnStarted, sessionId, commit_ok: commitOk, advanced, nextUp: nextUp(w3), tool_calls: tele.tool_calls, nudged, usage: { uncached: tot.uncached, read: tot.read, write: tot.write, output: tot.output }, latency_ms: tot.latency }, null, 2));
