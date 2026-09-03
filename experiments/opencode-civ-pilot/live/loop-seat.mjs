// Event-driven turn-gated supervisor for one seat. Game events arrive over
// the bridge SSE stream; each turn advance wakes the loop, which pauses the
// game, runs one cognition opportunity on the seat persistent session, and
// resumes on commit. Pause-upfront is deliberate: the world waits for the
// mind, so observations never race the game and commits land at decision
// time. Execution is serial per seat, STOP is honored between phases, and
// reconnects use capped backoff with the gap logged and one catch-up run.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callLive } from "./live-mcp.mjs";

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
function appendEpoch(e) { try { fs.appendFileSync(path.join(rundir, "epochs.jsonl"), JSON.stringify(e) + NL); } catch (err) { log("epoch write failed"); } }
let gameID = null;
let running = false;
async function handleTurn(turn) {
  if (running || stopped() || turn <= doneTurn) return;
  running = true;
  const triggers = pending.splice(0);
  if (!triggers.includes(turn)) triggers.push(turn);
  const epoch = { ts: new Date().toISOString(), seat, gameID, observationTurn: turn, triggers, collapsed: triggers.filter((t) => t < turn) };
  const t0 = Date.now();
  let code = -1;
  try {
    log("seat turn " + turn + " pausing");
    await pause();
    if (!(await acquireLock(seat, turn))) return;
    if (stopped()) return;
    process.env.CIV_PILOT_TRIGGER_TURN = String(turn);
    const t1 = Date.now();
    const res = await runOnce(turn);
    code = res.code;
    epoch.cognitionMs = Date.now() - t1;
    log("turn " + turn + " exit " + res.code);
    if (res.code === 0) doneTurn = turn;
  } finally {
    try { await resume(); } catch (e) {}
    epoch.exit = code;
    epoch.committedTurn = code === 0 ? turn : null;
    epoch.pausedMs = Date.now() - t0;
    releaseLock(seat);
    appendEpoch(epoch);
    running = false;
  }
}
async function confirmAndRun() {
  let st = null;
  try { st = await status(); } catch (e) { log("status failed: " + e.message); return; }
  if (st.gameID !== gameID) { gameID = st.gameID; doneTurn = -1; log("new game; watermark reset"); }
  if (running) {
    if (st.turn > doneTurn && !pending.includes(st.turn)) { pending.push(st.turn); log("trigger T" + st.turn + " arrived while busy"); }
    return;
  }
  await handleTurn(st.turn);
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
let lastCheck = 0;
function onBlock(block) {
  const datas = block.split("\n").filter((l) => l.indexOf("data:") === 0).map((l) => l.slice(5).trim());
  if (!datas.length) return;
  let payload = null;
  try { payload = JSON.parse(datas.join("\n")); } catch (e) { return; }
  const items = Array.isArray(payload) ? payload : [payload];
  let gameSeen = false;
  for (const it of items) {
    const p = it?.payload ?? it?.data ?? it;
    const t = Number(p?.Turn ?? p?.turn);
    if (p && typeof p === "object") gameSeen = true;
    if (Number.isFinite(t)) confirmAndRun();
  if (gameSeen) { const now = Date.now(); if (now - lastCheck > 5000) { lastCheck = now; confirmAndRun(); } }
  }
}
log("loop start seat " + seat);
await watch();
