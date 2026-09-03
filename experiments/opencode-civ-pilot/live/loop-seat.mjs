// Seat-turn-gated supervisor for one civilization. The loop wakes only when
// its own seat native turn begins (SSE PlayerDoTurn for its player, or the
// cheap status poll showing it is the active player). It pauses, refuses
// unless the active player is still its own, runs one cognition opportunity
// on the seat persistent session, and resumes on commit. Execution is serial
// per seat, STOP is honored between phases, and reconnects use capped
// backoff with the gap logged and one catch-up run.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callLive } from "./live-mcp.mjs";
import { loadSeats, seatPlayer } from "../driver/seats.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const NL = String.fromCharCode(10);
const SSE_URL = process.env.CIV_PILOT_SSE_URL || "http://127.0.0.1:5000/events";
function arg(name, dflt = null) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? (process.argv[i + 1] ?? dflt) : dflt;
}
const seat = Number(arg("seat", NaN));
const game = arg("game", "fourway");
const rundirArg = arg("rundir", null);
const runBudgetMs = Number(arg("run-budget-ms", 12 * 60 * 1000));
if (!Number.isInteger(seat) || !rundirArg) { console.error("usage: loop-seat.mjs --seat N --rundir ABS [--game g]"); process.exit(2); }
const rundir = path.isAbsolute(rundirArg) ? rundirArg : path.resolve(process.cwd(), rundirArg);
fs.mkdirSync(rundir, { recursive: true });
const stopf = path.join(rundir, "STOP");
const logf = path.join(rundir, "loop-seat-" + seat + ".log");
function log(m) { fs.appendFileSync(logf, new Date().toISOString() + " " + m + NL); }
const stopped = () => fs.existsSync(stopf);
async function status() {
  const r = await callLive("get-game-status", {});
  return r.structuredContent ?? r;
}
async function pause() { try { await callLive("pause-game", { PlayerID: seat }); } catch (e) { log("pause failed: " + e.message); } }
async function resume() { try { await callLive("resume-game", { PlayerID: seat }); } catch (e) { log("resume failed: " + e.message); } }
function runOnce(turn) {
  return new Promise((resolve) => {
    const c = spawn("node", ["run-live-seat.mjs", "--seat", String(seat), "--turn", String(turn), "--rundir", rundir, "--game", game], { cwd: here });
    let out = "";
    c.stdout.on("data", (d) => { out += d.toString(); });
    c.stderr.on("data", (d) => { out += d.toString(); });
    const t = setTimeout(() => { try { c.kill(); } catch (e) {} resolve({ code: 124, out }); }, runBudgetMs);
    c.on("close", (cc) => { clearTimeout(t); resolve({ code: cc === null ? 1 : cc, out }); });
  });
}
let doneTurn = -1;
let pending = [];
let runningTurn = null;
// The Vox player id for this seat (usually equals the seat number).
const MY_PLAYER = (() => {
  try {
    const rows = loadSeats();
    const p = seatPlayer(seat, rows);
    return Number.isInteger(p) ? p : seat;
  } catch { return seat; }
})();
// Durable cognition state: survives supervisor restarts so a failed or
// interrupted decision is retried or recorded as missed, never dropped.
const cogStateFile = path.join(rundir, "cognition-state.json");
function loadCogState() {
  try { return JSON.parse(fs.readFileSync(cogStateFile, "utf8")); }
  catch { return null; }
}
function saveCogState(s) {
  try { fs.writeFileSync(cogStateFile, JSON.stringify(s, null, 1)); }
  catch (e) { log("cogstate write failed: " + e.message); }
}
let lastMissedRecorded = -1;
function appendEpoch(e) { try { fs.appendFileSync(path.join(rundir, "epochs.jsonl"), JSON.stringify(e) + NL); } catch (err) { log("epoch write failed"); } }
let gameID = null;
let running = false;
async function handleTurn(turn, wake) {
  if (running || stopped() || turn <= doneTurn) return;
  running = true;
  runningTurn = turn;
  const triggers = pending.splice(0);
  if (!triggers.includes(turn)) triggers.push(turn);
  const epoch = { ts: new Date().toISOString(), kind: "cognition", seat, gameID, gameTurn: turn, observationTurn: turn, expectedPlayerID: MY_PLAYER, triggerPlayerID: wake?.playerID ?? null, wakeSource: wake?.source ?? "poll", activePlayerID: null, triggers, collapsed: triggers.filter((t) => t < turn) };
  const t0 = Date.now();
  let code = -1;
  try {
    log("seat turn " + turn + " pausing");
    await pause();
    let stNow = null;
    try { stNow = await status(); } catch (e) { log("post-pause status failed: " + e.message); }
    epoch.activePlayerID = stNow ? stNow.activePlayerId ?? null : null;
    if (stNow && Number(stNow.activePlayerId) !== Number(MY_PLAYER)) {
      log("refusing T" + turn + ": active player " + stNow.activePlayerId + " is not mine " + MY_PLAYER);
      epoch.kind = "refused";
      code = 2;
      return;
    }
    if (!(await acquireLock(seat, turn))) return;
    if (stopped()) return;
    saveCogState({ gameId: gameID, lastSuccessfulDecisionTurn: doneTurn, pendingDecisionTurn: turn, pendingStatus: "running" });
    process.env.CIV_PILOT_TRIGGER_TURN = String(turn);
    const t1 = Date.now();
    const res = await runOnce(turn);
    code = res.code;
    epoch.cognitionMs = Date.now() - t1;
    log("turn " + turn + " exit " + res.code);
    if (res.code === 0) {
      doneTurn = turn;
      saveCogState({ gameId: gameID, lastSuccessfulDecisionTurn: turn, pendingDecisionTurn: null, pendingStatus: "completed" });
    } else {
      saveCogState({ gameId: gameID, lastSuccessfulDecisionTurn: doneTurn, pendingDecisionTurn: turn, pendingStatus: "failed" });
    }
  } finally {
    try { await resume(); } catch (e) {}
    epoch.exit = code;
    epoch.committedTurn = code === 0 ? turn : null;
    epoch.pausedMs = Date.now() - t0;
    releaseLock(seat);
    appendEpoch(epoch);
    running = false;
    runningTurn = null;
  }
}
function recordMissed(missedTurn, liveTurn, reason) {
  appendEpoch({ ts: new Date().toISOString(), kind: "missed_epoch", seat, gameID, missedTurn, liveTurn, reason });
  saveCogState({ gameId: gameID, lastSuccessfulDecisionTurn: doneTurn, pendingDecisionTurn: null, pendingStatus: "missed" });
  lastMissedRecorded = missedTurn;
  log("missed_epoch T" + missedTurn + " (live T" + liveTurn + "): " + reason);
}
async function confirmAndRun(wake) {
  let st = null;
  try { st = await status(); } catch (e) { log("status failed: " + e.message); return; }
  if (st.gameID !== gameID) {
    gameID = st.gameID;
    const saved = loadCogState();
    if (saved && saved.gameId === gameID && Number.isInteger(saved.lastSuccessfulDecisionTurn)) {
      doneTurn = saved.lastSuccessfulDecisionTurn;
      pending = [];
      log("same game; watermark restored at T" + doneTurn);
    } else {
      doneTurn = -1;
      pending = [];
      saveCogState({ gameId: gameID, lastSuccessfulDecisionTurn: -1, pendingDecisionTurn: null, pendingStatus: null });
      log("new game; watermark reset");
    }
  }
  const cs = !running ? loadCogState() : null;
  if (cs && cs.gameId === gameID && cs.pendingDecisionTurn != null && cs.pendingStatus !== "completed" && cs.pendingStatus !== "missed") {
    if (st.turn <= cs.pendingDecisionTurn) {
      log("retrying pending T" + cs.pendingDecisionTurn + " (status " + cs.pendingStatus + ")");
      if (!running) await handleTurn(cs.pendingDecisionTurn, { source: "recovery", playerID: MY_PLAYER });
      return;
    }
    recordMissed(cs.pendingDecisionTurn, st.turn, "game advanced past uncommitted decision");
  }
  if (st.turn > doneTurn + 1 && st.turn - 1 > lastMissedRecorded && doneTurn >= 0) {
    recordMissed(doneTurn + 1, st.turn, "turn completed with no cognition for this seat");
    doneTurn = st.turn - 1;
  }
  if (running) {
    const cand = wake && Number.isFinite(wake.turn) ? wake.turn : st.turn;
    if (cand > runningTurn && cand > doneTurn && !pending.includes(cand)) {
      pending.push(cand);
      log("trigger T" + cand + " queued while running T" + runningTurn);
    }
    return;
  }
  if (wake && Number(wake.playerID) === Number(MY_PLAYER) && Number.isFinite(wake.turn) && wake.turn > doneTurn) {
    await handleTurn(wake.turn, wake);
    return;
  }
  if (Number(st.activePlayerId) === Number(MY_PLAYER) && st.turn > doneTurn) {
    await handleTurn(st.turn, { source: "poll", playerID: st.activePlayerId });
  }
}
function sleepMs(ms) { return new Promise((r) => setTimeout(r, ms)); }
const lockFile = path.join(here, "run-lock.json");
// Cooperative serial lock across seat loops: only one cognition run at a
// time, so observations never stack game-lock probes. Stale claims expire.
async function acquireLock(seat, turn) {
  while (!stopped()) {
    let held = null;
    try { held = JSON.parse(fs.readFileSync(lockFile, "utf8")); } catch (e) {}
    if (!held || Date.now() - new Date(held.at).getTime() > 15 * 60 * 1000) {
      try {
        fs.writeFileSync(lockFile, JSON.stringify({ seat, turn, at: new Date().toISOString() }));
        await sleepMs(500);
        const back = JSON.parse(fs.readFileSync(lockFile, "utf8"));
        if (back.seat === seat) return true;
      } catch (e) {}
    }
    await sleepMs(5000);
  }
  return false;
}
function releaseLock(seat) {
  try {
    const o = JSON.parse(fs.readFileSync(lockFile, "utf8"));
    if (o.seat === seat) fs.unlinkSync(lockFile);
  } catch (e) {}
}
async function watch() {
  let backoff = 1000;
  while (!stopped()) {
    try {
      await streamEvents();
      if (stopped()) break;
      log("stream ended; reconnecting");
    } catch (e) {
      log("stream error: " + e.message);
    }
    const wait = Math.min(backoff, 30000);
    backoff = Math.min(backoff * 2, 30000);
    const t0 = Date.now();
    while (Date.now() - t0 < wait && !stopped()) await sleepMs(1000);
    if (stopped()) break;
    log("reconnecting; will catch up from the live turn");
    await confirmAndRun();
    backoff = 1000;
  }
  log("loop stopped");
}
const CR = String.fromCharCode(13);
async function streamEvents() {
  const res = await fetch(SSE_URL, { headers: { Accept: "text/event-stream" } });
  if (!res.ok || !res.body) throw new Error("sse connect failed");
  log("stream connected");
  await confirmAndRun();
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    if (stopped()) { try { await reader.cancel(); } catch (e) {} return; }
    const { done, value } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true }).split(String.fromCharCode(13) + NL).join(NL);
    let cut = buf.indexOf("\n\n");
    while (cut >= 0) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      onBlock(block);
      cut = buf.indexOf("\n\n");
    }
  }
}
// SSE envelopes vary (better-sse event lines, DLL game_event batches).
// Only a payload naming this seat player wakes the loop; anything else is
// left to the status poll below.
function onBlock(block) {
  const lines = block.split("\n");
  const eventName = (lines.find((l) => l.indexOf("event:") === 0) ?? "").slice(6).trim();
  const datas = lines.filter((l) => l.indexOf("data:") === 0).map((l) => l.slice(5).trim());
  if (!datas.length) return;
  let payload = null;
  try { payload = JSON.parse(datas.join("\n")); } catch (e) { return; }
  const items = Array.isArray(payload) ? payload : [payload];
  for (const it of items) {
    const p = it?.payload ?? it?.data ?? it?.extraPayload ?? it;
    if (!p || typeof p !== "object") continue;
    const t = Number(p.Turn ?? p.turn);
    const pid = p.PlayerID ?? p.playerID ?? p.playerId;
    if (Number.isFinite(t) && pid !== undefined && Number(pid) === Number(MY_PLAYER)) {
      confirmAndRun({ source: "event:" + (it?.type ?? it?.event ?? eventName ?? "turn"), playerID: Number(pid), turn: t });
    }
  }
}
// Cheap status poll: wakes this seat when it is the active player even if
// no seat-addressed SSE event arrives. Poll-safe (no game lock).
let pollTimer = null;
function startPoll() {
  stopPoll();
  pollTimer = setInterval(() => { if (!stopped()) confirmAndRun(null); }, 5000);
}
function stopPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}
log("loop start seat " + seat);
startPoll();
await watch();
stopPoll();
