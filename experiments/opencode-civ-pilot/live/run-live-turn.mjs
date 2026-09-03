// One LIVE cognition opportunity for seat 1 (Siam, PlayerID 1, Ramkhamhaeng).
// Builds a small dashboard observation from the live Vox MCP, appends it to
// Siam's ONE persistent OpenCode session (this live/ dir), then applies the
// committed actions back to the live game through the Vox MCP tools.
// Usage: node run-live-turn.mjs --turn <liveTurn> [--session <id>] [--game <name>]
// NEVER start a fresh session per turn; pass --session to resume (stored in
// civ-state-siam.json automatically).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appendToSession, readCommit, clearCommit } from "../driver/session-manager.mjs";
import { appendTelemetry, exportUsageDelta } from "../driver/telemetry.mjs";
import { buildObservation } from "./observe.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pilotDir = path.resolve(here, "..");
const CIV = "Siam";
const LEADER = "Ramkhamhaeng";
const PLAYER_ID = 1;
const RIVAL_ID = 0;
const MODEL = "opencode-go/muse-spark-1.3-contributor";
const MCP_URL = process.env.MCP_URL || "http://127.0.0.1:4000/mcp";

// Civ name -> seat ID for posture targets (model sometimes sends names).
const SEAT_BY_NAME = { siam: PLAYER_ID, portugal: RIVAL_ID };
function coerceTargetID(v, dflt) {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string") {
    const hit = SEAT_BY_NAME[v.trim().toLowerCase()];
    if (hit !== undefined) return hit;
    const n = Number(v);
    if (Number.isInteger(n)) return n;
  }
  return dflt;
}

function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? dflt) : dflt;
}

const turn = Number(arg("turn", NaN));
if (!Number.isFinite(turn)) {
  console.error("pass --turn <live game turn>");
  process.exit(2);
}
const game = arg("game", "live-duel");
const rundirArg = arg("rundir", "runs/live");
// Resolve relative rundirs against the caller's cwd, not the pilot dir, so
// `node live/run-live-turn.mjs --rundir live/runs-siam` lands where expected.
const rundir = path.isAbsolute(rundirArg) ? rundirArg : path.resolve(process.cwd(), rundirArg);
let sessionId = arg("session", null);

const stateFile = path.join(here, "civ-state-siam.json");
let state = {};
try {
  state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  if (!sessionId) sessionId = state.sessionId ?? null;
} catch { /* first run */ }
const prevCount = state.messageCount ?? 0;
const lastSeenTurn = state.lastSeenTurn ?? 0;
const lastApplied = Array.isArray(state.lastApplied) ? state.lastApplied : [];

let mcpSession = null;
async function rpc(method, params) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (mcpSession) headers["mcp-session-id"] = mcpSession;
  const r = await fetch(MCP_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: String(Date.now()), method, params }),
  });
  const sid = r.headers.get("mcp-session-id");
  if (sid) mcpSession = sid;
  const text = await r.text();
  const chunks = [...text.matchAll(/^data:\s*(\{.*\})\s*$/gm)].map((m) => m[1]);
  return JSON.parse(chunks.length ? chunks[chunks.length - 1] : text);
}
async function callTool(name, args) {
  if (!mcpSession) {
    await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "run-live-turn", version: "1" },
    });
    await rpc("notifications/initialized", {});
  }
  const out = await rpc("tools/call", { name, arguments: args });
  if (out?.result?.isError) throw new Error(out.result.content?.[0]?.text ?? "MCP error");
  const t = out.result.content?.[0]?.text ?? "{}";
  try {
    return JSON.parse(t);
  } catch {
    return { raw: t };
  }
}
function mcpCallSync(tool, args) {
  const r = spawnSync("node", [path.join(pilotDir, "driver", "mcp-call.mjs"), tool, JSON.stringify(args)], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // Never hang a live turn forever on one stuck apply: fail fast and let
    // the write-back loop report NOT applied next turn. Harness-only change.
    timeout: Number(process.env.VOX_LIVE_APPLY_TIMEOUT_MS ?? 90000),
  });
  return { status: r.status, out: (r.stdout ?? "").slice(-1500), err: (r.stderr ?? "").slice(-500) };
}

// Shared observation (observe.mjs): identical shape to what seat 0 sees via
// observe-seat.mjs, plus condensed military zones and city builds.
const observation = await buildObservation({
  playerID: PLAYER_ID, civ: CIV, leader: LEADER, seat: PLAYER_ID,
  rivalID: RIVAL_ID, rivalCiv: "Portugal", rivalLeader: "Maria I", rivalSeat: RIVAL_ID,
  turn, game, lastSeenTurn, lastApplied,
});

const commitFile = path.join(rundir, "last-commit-siam.json");
process.env.CIV_PILOT_COMMIT_FILE = commitFile;
process.env.CIV_PILOT_PLAYER_ID = String(PLAYER_ID);
process.env.MCP_URL = MCP_URL;
delete process.env.ALLOW_DIPLOMACY;
clearCommit(commitFile);

const t0 = Date.now();
let res = await appendToSession({
  dir: here, sessionId, message: observation, model: MODEL,
  title: `${CIV} civ mind (live)`, timeoutMs: 300000,
});
if (res.sessionId) sessionId = res.sessionId;
const allCalls = [...res.toolCalls];
let commit = readCommit(commitFile);
let nudged = false;
if (!commit || (!commit.actions && !commit.pass)) {
  nudged = true;
  const r2 = await appendToSession({
    dir: here, sessionId,
    message: "You have not committed this turn. Call commit_turn (or pass) now.",
    model: MODEL, timeoutMs: 180000,
  });
  for (const t of r2.toolCalls) allCalls.push({ ...t, followup: true });
  commit = readCommit(commitFile);
}

const applied = [];
let commitOk = false;
if (commit && (commit.actions || commit.pass)) {
  commitOk = true;
  const rationale = commit.rationale ?? commit.reason ?? "live harness turn";
  for (const a of commit.actions ?? []) {
    const p = a.params ?? {};
    let mapped = null;
    switch (a.type) {
      case "keep_status_quo":
        mapped = ["keep-status-quo", { PlayerID: PLAYER_ID, Mode: p.mode ?? "Strategy", Rationale: rationale }];
        break;
      case "strategy":
        mapped = ["set-strategy", { PlayerID: PLAYER_ID, Rationale: rationale, ...(p.grandStrategy ? { GrandStrategy: p.grandStrategy } : {}), ...(p.economic ? { EconomicStrategies: p.economic } : {}), ...(p.military ? { MilitaryStrategies: p.military } : {}) }];
        break;
      case "research":
        {
          const tech = p.technology ?? p.next ?? p.tech;
          if (typeof tech !== "string" || !tech.trim()) { applied.push({ type: a.type, ok: false, note: "missing params.technology (exact technology name)" }); continue; }
          mapped = ["set-research", { PlayerID: PLAYER_ID, Technology: tech, Rationale: rationale }];
        }
        break;
      case "policy":
        if (typeof p.policy !== "string" || !p.policy.trim()) { applied.push({ type: a.type, ok: false, note: "missing params.policy (exact policy or branch name)" }); continue; }
        mapped = ["set-policy", { PlayerID: PLAYER_ID, Policy: p.policy, Rationale: rationale }];
        break;
      case "posture":
        // Only civilization-level stances map to set-relationship. City-level
        // tactical postures (e.g. {city, posture}) are VPAI's job: skip them
        // rather than inventing a diplomacy change.
        if (typeof p.public !== "number" && typeof p.private !== "number") { applied.push({ type: a.type, ok: false, note: "skipped: city-level posture, no civ stance given (not mapped to diplomacy)" }); continue; }
        mapped = ["set-relationship", { PlayerID: PLAYER_ID, TargetID: coerceTargetID(p.targetID, RIVAL_ID), Public: p.public ?? 0, Private: p.private ?? 0, Rationale: rationale }];
        break;
      case "production_mode":
        // Only an explicit boolean toggles the global production mode. City
        // build choices (e.g. {city, mode}) must never flip this switch.
        if (typeof p.enabled !== "boolean") { applied.push({ type: a.type, ok: false, note: "skipped: no boolean params.enabled (city builds stay with the game)" }); continue; }
        mapped = ["set-production-mode", { enabled: p.enabled }];
        break;
      case "deal_propose": {
        // Formal proposal: Vox validates legality; failures return with reasons.
        const items = p.items;
        if (!Array.isArray(items) || !items.length) { applied.push({ type: a.type, ok: false, note: "missing params.items[] (deal item list)" }); continue; }
        const msg = typeof p.message === "string" && p.message.trim() ? p.message : `Proposal from ${CIV}.`;
        mapped = ["append-message", { PlayerAID: Math.min(PLAYER_ID, RIVAL_ID), PlayerBID: Math.max(PLAYER_ID, RIVAL_ID), PlayerARole: "strategist", PlayerBRole: "strategist", SpeakerID: PLAYER_ID, MessageType: "deal-proposal", Content: msg, Payload: { Deal: { version: 1, items, promises: Array.isArray(p.promises) ? p.promises : [] }, message: msg } }];
        break;
      }
      case "deal_accept": {
        const id = p.proposalId ?? p.proposalID ?? p.id;
        if (!Number.isInteger(id)) { applied.push({ type: a.type, ok: false, note: "missing params.proposalId (deal-proposal message ID)" }); continue; }
        mapped = ["enact-agent-deal", { ProposalMessageID: id }];
        break;
      }
      case "deal_reject": {
        const id = p.proposalId ?? p.proposalID ?? p.id;
        if (!Number.isInteger(id)) { applied.push({ type: a.type, ok: false, note: "missing params.proposalId (deal-proposal message ID)" }); continue; }
        mapped = ["reject-agent-deal", { PlayerAID: Math.min(PLAYER_ID, RIVAL_ID), PlayerBID: Math.max(PLAYER_ID, RIVAL_ID), ProposalMessageID: id, SpeakerID: PLAYER_ID, ...(typeof p.reason === "string" && p.reason.trim() ? { Content: p.reason } : {}) }];
        break;
      }
      default:
        applied.push({ type: a.type, ok: false, note: "no live mapping yet" });
        continue;
    }
    const r = mcpCallSync(mapped[0], mapped[1]);
    applied.push({ type: a.type, tool: mapped[0], ok: r.status === 0 && !/"isError":\s*true/.test(r.out), out: r.out.slice(-300) });
  }
}

const usage = sessionId ? exportUsageDelta(sessionId, prevCount) : null;
const tot = { uncached: 0, read: 0, write: 0, output: 0, reasoning: 0 };
// Wall-clock gap since the previous cognition opportunity: cache TTL expires
// after idle minutes (T177/T180 each cost ~120k fresh after 15-25min gaps vs
// 2.6k at T165 minutes after the prior turn). File-only telemetry, never
// model-visible.
const nowMs = Date.now();
const wallGapSec = state.lastTurnAt ? Math.round((nowMs - state.lastTurnAt) / 1000) : null;
if (usage) {
  Object.assign(tot, { uncached: usage.uncached, read: usage.read, write: usage.write, output: usage.output, reasoning: usage.reasoning });
  fs.mkdirSync(here, { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({ sessionId, messageCount: usage.newCount, lastSeenTurn: turn, lastTurnAt: nowMs, lastApplied: applied.map((a) => ({ type: a.type, ok: !!a.ok, note: a.note ?? null, out: (a.out ?? "").slice(0, 300) })) }));
}

const tele = {
  game, civ: CIV, turn, seq: turn, model: MODEL, sessionId,
  uncached_input_tokens: tot.uncached, cache_read_input_tokens: tot.read,
  cache_write_input_tokens: tot.write, output_tokens: tot.output,
  reasoning_tokens: tot.reasoning, latency_ms: nowMs - t0,
  wall_gap_sec: wallGapSec, session_messages: usage?.newCount ?? null,
  tool_calls: allCalls.map((t) => t.tool + (t.followup ? "+nudge" : "")),
  nudged, commit_ok: commitOk, applied, compaction: false,
  obs_chars: observation.length,
};
appendTelemetry(path.join(rundir, "telemetry-live.jsonl"), tele);
fs.mkdirSync(rundir, { recursive: true });
fs.appendFileSync(path.join(rundir, "transcript-live.md"),
  `\n\n## ${CIV} live turn ${turn} (session ${sessionId})\n\n### Observation sent\n\n${observation}\n\n### Tool calls\n\n${JSON.stringify(allCalls, null, 2)}\n\n### Commit\n\n${JSON.stringify(commit, null, 2)}\n\n### Applied to live game\n\n${JSON.stringify(applied, null, 2)}\n`);
console.log(JSON.stringify({ civ: CIV, turn, sessionId, commit_ok: commitOk, applied, nudged, usage: tot, tool_calls: tele.tool_calls }, null, 2));
