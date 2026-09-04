// Central turn router: exactly-once cognition per gameId:turn:playerId.
// SSE turn-open events are the primary fast path (pause immediately, verify
// after); one central 500ms status poll is the watchdog. Seat loops are
// retired; this process owns epoch claiming, pause, dispatch, and resume.
// Usage: node turn-router.mjs --game <name> --seats <seats.json> [--poll-ms 500]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callLive } from "./live-mcp.mjs";
import { loadSeats, seatPlayer } from "../driver/seats.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const NL = String.fromCharCode(10);
const SSE_URL = process.env.CIV_PILOT_SSE_URL || "http://127.0.0.1:5000/events";
const BRIDGE = process.env.CIV_PILOT_BRIDGE_URL || "http://127.0.0.1:5000";
const NO_SSE = process.env.CIV_PILOT_NO_SSE === "1";
const TURN_EVENTS = (process.env.CIV_PILOT_TURN_EVENTS || "PlayerDoTurn").split(",").map((s) => s.trim()).filter(Boolean);
const INJECT = process.env.CIV_PILOT_INJECT_EVENT || null;
function arg(name, dflt = null) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? (process.argv[i + 1] ?? dflt) : dflt;
}
const game = arg("game", null);
const seatsPath = arg("seats", path.join(here, "social-seats.json"));
const pollMs = Number(arg("poll-ms", 500));
const runBudgetMs = Number(arg("run-budget-ms", 12 * 60 * 1000));
if (!game) { console.error("usage: turn-router.mjs --game <name> [--seats file] [--poll-ms N]"); process.exit(2); }
process.env.CIV_PILOT_SEATS_FILE = path.isAbsolute(seatsPath) ? seatsPath : path.resolve(process.cwd(), seatsPath);
const SEAT_ROWS = loadSeats();
const seats = SEAT_ROWS.map((r) => ({ seat: Number(r.seat), player: seatPlayer(Number(r.seat), SEAT_ROWS), civ: String(r.civ ?? ("seat" + r.seat)).toLowerCase().replace(/[^a-z0-9]+/g, "") }));
if (!seats.length) { console.error("no seats in " + seatsPath); process.exit(2); }
const rundirFor = (civ) => path.join(here, "runs-" + game + "-" + civ);
const stopf = path.join(here, "STOP-ROUTER");
const stateFile = path.join(here, "router-state-" + game + ".json");
const logf = path.join(here, "turn-router-" + game + ".log");
function log(m) { fs.appendFileSync(logf, new Date().toISOString() + " " + m + NL); }
// Singleton enforcement: two routers must never dispatch against one game.
// In-memory claim/queue sets cannot dedupe across processes; a stale lock
// from a dead process is taken over, a live holder refuses startup.
const lockf = path.join(here, "router-" + game + ".lock");
const LOCK_BEAT_MS = 5000;
const LOCK_STALE_MS = 30000;
const GENERATION = process.pid + "-" + Date.now().toString(36);
let lockTimer = null;
function holderAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === "EPERM"; }
}
function lockPayload() {
  return { pid: process.pid, generation: GENERATION, startedAt: new Date().toISOString(), heartbeat: Date.now() };
}
function writeLockAtomic(obj) {
  const tmp = lockf + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, lockf);
}
function startHeartbeat() {
  stopHeartbeat();
  try {
    lockTimer = setInterval(() => {
      try {
        const cur = JSON.parse(fs.readFileSync(lockf, "utf8"));
        if (cur && cur.generation === GENERATION) writeLockAtomic(lockPayload());
        else stopHeartbeat();
      } catch { stopHeartbeat(); }
    }, LOCK_BEAT_MS);
    if (lockTimer.unref) lockTimer.unref();
  } catch {}
}
function stopHeartbeat() { try { if (lockTimer) clearInterval(lockTimer); } catch {} lockTimer = null; }
function acquireLock() {
  try {
    const prev = JSON.parse(fs.readFileSync(lockf, "utf8"));
    if (prev && holderAlive(Number(prev.pid)) && Number(prev.pid) !== process.pid) {
      console.error("another router holds " + lockf + " (pid " + prev.pid + "); refusing startup");
      process.exit(3);
    }
  } catch { /* missing lock: fall through to the atomic claim below */ }
  // Atomic claim: O_EXCL fails if the file exists, so two starters cannot
  // both believe they won. Falls through to takeover when claimed.
  try {
    const fd = fs.openSync(lockf, "wx");
    fs.writeFileSync(fd, JSON.stringify(lockPayload()));
    fs.closeSync(fd);
    log("lock claimed fresh generation=" + GENERATION);
    startHeartbeat();
    return;
  } catch (e) { if (!e || (e.code !== "EEXIST" && e.code !== "ENOENT")) throw e; }
  // Takeover path: live holder (pid alive AND heartbeat fresh) refuses
  // startup; anything else is stale and taken over loudly.
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(lockf, "utf8")); } catch { prev = null; }
  const beat = prev ? Number(prev.heartbeat ?? 0) : 0;
  const fresh = prev && holderAlive(Number(prev.pid)) && (Date.now() - beat) < LOCK_STALE_MS;
  if (fresh && Number(prev.pid) !== process.pid) {
    console.error("another router holds " + lockf + " (pid " + prev.pid + " gen " + prev.generation + "); refusing startup");
    process.exit(3);
  }
  if (prev) log("TAKEOVER stale lock pid=" + prev.pid + " gen=" + prev.generation + " beatAgeMs=" + (Date.now() - beat));
  else log("lock file unreadable; claiming");
  writeLockAtomic(lockPayload());
  log("lock claimed via takeover generation=" + GENERATION);
  startHeartbeat();
}
function releaseLock() {
  stopHeartbeat();
  try {
    const cur = JSON.parse(fs.readFileSync(lockf, "utf8"));
    if (cur && cur.generation === GENERATION) fs.unlinkSync(lockf);
    else log("lock not ours at release; leaving it");
  } catch {}
}
const stopped = () => fs.existsSync(stopf);
const seatStopped = (civ) => fs.existsSync(path.join(rundirFor(civ), "STOP"));
function epochKey(gameId, turn, player) { return gameId + ":" + turn + ":" + player; }
let S = { gameId: null, claimed: {}, counters: { eventWins: 0, pollWins: 0, recoveryWins: 0, misses: 0, duplicates: 0, refusals: 0, falsePauses: 0 } };
function saveState() { try { fs.writeFileSync(stateFile, JSON.stringify(S)); } catch (e) { log("router-state write failed"); } }
function loadState() { try { const s = JSON.parse(fs.readFileSync(stateFile, "utf8")); if (s && typeof s === "object") S = { ...S, ...s }; } catch {} }
function seatEpochFile(civ, name) { return path.join(rundirFor(civ), name); }
function appendSeatEpoch(civ, e) { try { fs.mkdirSync(rundirFor(civ), { recursive: true }); fs.appendFileSync(seatEpochFile(civ, "epochs.jsonl"), JSON.stringify(e) + NL); } catch (err) { log("epoch write failed " + civ); } }
function loadCogState(civ) { try { return JSON.parse(fs.readFileSync(seatEpochFile(civ, "cognition-state.json"), "utf8")); } catch { return null; } }
function saveCogState(civ, s) { try { fs.mkdirSync(rundirFor(civ), { recursive: true }); fs.writeFileSync(seatEpochFile(civ, "cognition-state.json"), JSON.stringify(s, null, 1)); } catch (e) { log("cogstate write failed " + civ); } }
function maxCommitted(civ) {
  let best = -1;
  try {
    for (const line of fs.readFileSync(seatEpochFile(civ, "epochs.jsonl"), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { const e = JSON.parse(line); if (Number.isInteger(e.committedTurn) && e.committedTurn > best) best = e.committedTurn; } catch {}
    }
  } catch {}
  return best;
}
async function status() { const r = await callLive("get-game-status", {}); return r.structuredContent ?? r; }
async function bridgePost(p, body) {
  const r = await fetch(BRIDGE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
async function pauseNow() { const t0 = Date.now(); const r = await bridgePost("/external/pause"); return { ok: !!r?.success, ms: Date.now() - t0 }; }
async function resumeNow() { const t0 = Date.now(); const r = await bridgePost("/external/resume"); return { ok: !!r?.success, ms: Date.now() - t0 }; }
process.on("SIGINT", () => { resumeNow().finally(() => { releaseLock(); process.exit(0); }); });
process.on("SIGTERM", () => { resumeNow().finally(() => { releaseLock(); process.exit(0); }); });
// Released on natural drain (including in-flight cognition) so a successor
// never overlaps a live dispatch. Crashes leave a stale lock, which the
// next startup takes over after a liveness check.
process.on("beforeExit", () => { releaseLock(); });
function playerSeat(player) { return seats.find((s) => Number(s.player) === Number(player)) ?? null; }
function claim(key, source) {
  if (S.claimed[key]) { S.counters.duplicates++; S.counters.dupClaimed = (S.counters.dupClaimed ?? 0) + 1; saveState(); return false; }
  S.claimed[key] = { ts: new Date().toISOString(), source };
  S.counters[source === "event" ? "eventWins" : source === "poll" ? "pollWins" : "recoveryWins"]++;
  saveState();
  return true;
}
function runSeat(entry, turn) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      CIV_PILOT_SEATS_FILE: process.env.CIV_PILOT_SEATS_FILE,
      CIV_PILOT_STATE_FILE: path.join(here, "civ-state-" + game + "-" + entry.seat + ".json"),
      CIV_PILOT_CHANNELS_FILE: path.join(here, "channels-" + game + ".json"),
      CIV_PILOT_TRIGGER_TURN: String(turn),
    };
    delete env.OPENCODE_SERVER_PASSWORD;
    delete env.OPENCODE_SERVER_USERNAME;
    const c = spawn("node", ["run-live-seat.mjs", "--seat", String(entry.seat), "--turn", String(turn), "--rundir", rundirFor(entry.civ), "--game", game], { cwd: here, env });
    let out = "";
    c.stdout.on("data", (d) => { out += d.toString(); });
    c.stderr.on("data", (d) => { out += d.toString(); });
    const t = setTimeout(() => { try { c.kill(); } catch {} resolve({ code: 124, out }); }, runBudgetMs);
    c.on("close", (cc) => { clearTimeout(t); resolve({ code: cc === null ? 1 : cc, out }); });
  });
}
let busy = false;
const queue = [];
let runningKey = null;
const queuedKeys = new Set();
const pendingEvents = [];
let lastResumeAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let streamHealthy = false;
const eventsSeenTurns = new Set();
let lastPollState = null;
async function resumeTracked() {
  try { await resumeNow(); } finally { lastResumeAt = Date.now(); }
}
async function dispatch(entry, turn, trig, alreadyPaused) {
  const key = epochKey(S.gameId, turn, entry.player);
  runningKey = key;
  const ep = {
    ts: new Date().toISOString(), kind: "cognition", seat: entry.seat, gameID: S.gameId,
    gameTurn: turn, observationTurn: turn, expectedPlayerID: entry.player,
    triggerPlayerID: trig.playerID, wakeSource: trig.source,
    nativeEventType: trig.eventType ?? null, sseReceivedAt: trig.sseAt ?? null,
    pollDetectedAt: trig.pollAt ?? null, epochClaimedAt: trig.claimedAt,
    activePlayerID: null, triggers: [turn], collapsed: Array.isArray(trig.collapsed) ? trig.collapsed : [],
  };
  const cs = loadCogState(entry.civ) || {};
  saveCogState(entry.civ, { gameId: S.gameId, lastSuccessfulDecisionTurn: cs.lastSuccessfulDecisionTurn ?? maxCommitted(entry.civ), pendingDecisionTurn: turn, pendingStatus: "running" });
  ep.pauseRequestedAt = new Date().toISOString();
  let pq = { ok: trig.prePaused === true, ms: 0 };
  if (!trig.prePaused) {
    // Rapid resume-then-pause transitions have silently failed before (the
    // bridge reports failure, or the engine keeps rolling). Let the previous
    // resume settle, retry a failed pause, and never think unpaused.
    const settle = Math.max(0, 750 - (Date.now() - lastResumeAt));
    if (settle > 0) await sleep(settle);
    log("pause for " + key + " via " + trig.source);
    pq = await pauseNow();
    for (let attempt = 1; attempt <= 3 && !pq.ok; attempt++) {
      await sleep(400);
      log("pause retry " + attempt + " for " + key);
      pq = await pauseNow();
    }
  }
  ep.pauseReturnedAt = new Date().toISOString();
  ep.pauseOk = pq.ok;
  if (!pq.ok && !trig.prePaused) {
    log("refusing " + key + ": pause_failed");
    ep.kind = "refused";
    ep.exit = 2;
    ep.missReason = "pause_failed";
    ep.frozen = false;
    S.counters.refusals++;
    delete S.claimed[key];
    saveState();
    await resumeTracked();
    appendSeatEpoch(entry.civ, ep);
    runningKey = null;
    return;
  }
  // Freeze verification: a successful pause call does not prove the engine
  // froze. Take three spaced reads; the game must be stationary on the last
  // two before an expensive cognition is allowed to run. stNow keeps the
  // same shape the checks below expect.
  const reads = [];
  for (let i = 0; i < 3; i++) {
    try {
      const s = await status();
      reads.push({ turn: s.turn, activePlayerId: s.activePlayerId ?? null, gameID: s.gameID ?? null });
    } catch (e) { log("post-pause status failed: " + e.message); break; }
    if (i < 2) await sleep(350);
  }
  const frozen = reads.length >= 2
    && reads[reads.length - 1].turn === reads[reads.length - 2].turn
    && reads[reads.length - 1].activePlayerId === reads[reads.length - 2].activePlayerId;
  ep.frozen = frozen;
  ep.freezeReads = reads.length;
  let stNow = reads.length ? reads[reads.length - 1] : null;
  ep.statusVerifiedAt = new Date().toISOString();
  ep.activePlayerID = stNow ? stNow.activePlayerId ?? null : null;
  if (!stNow || stNow.gameID !== S.gameId || Number(stNow.activePlayerId) !== Number(entry.player)) {
    log("refusing " + key + ": active=" + ep.activePlayerID);
    ep.kind = "refused";
    ep.exit = 2;
    ep.missReason = "active_player_changed_before_pause";
    S.counters.refusals++;
    S.counters.falsePauses++;
    saveState();
    await resumeTracked();
    appendSeatEpoch(entry.civ, ep);
    runningKey = null;
    return;
  }
  if (!frozen) {
    log("refusing " + key + ": game_not_frozen");
    ep.kind = "refused";
    ep.exit = 2;
    ep.missReason = "game_not_frozen";
    S.counters.refusals++;
    S.counters.falsePauses++;
    saveState();
    await resumeTracked();
    appendSeatEpoch(entry.civ, ep);
    runningKey = null;
    return;
  }
  const t1 = Date.now();
  ep.cognitionStartedAt = new Date().toISOString();
  const res = await runSeat(entry, turn);
  ep.cognitionFinishedAt = new Date().toISOString();
  ep.cognitionMs = Date.now() - t1;
  log(key + " exit " + res.code);
  const t2 = Date.now();
  await resumeTracked();
  ep.resumeRequestedAt = new Date().toISOString();
  ep.resumeReturnedAt = ep.resumeRequestedAt;
  ep.exit = res.code;
  ep.committedTurn = res.code === 0 ? turn : null;
  ep.committed = res.code === 0;
  ep.pausedMs = Date.now() - (trig.detectedAtMs ?? t1);
  const prev = loadCogState(entry.civ) || {};
  if (res.code === 0) saveCogState(entry.civ, { gameId: S.gameId, lastSuccessfulDecisionTurn: turn, pendingDecisionTurn: null, pendingStatus: "completed" });
  else saveCogState(entry.civ, { gameId: S.gameId, lastSuccessfulDecisionTurn: prev.lastSuccessfulDecisionTurn ?? maxCommitted(entry.civ), pendingDecisionTurn: turn, pendingStatus: res.code === 124 ? "timeout" : "failed" });
  appendSeatEpoch(entry.civ, ep);
  runningKey = null;
  void t2;
}
function missReasonFor(turn) {
  if (!streamHealthy) return "router_down";
  return eventsSeenTurns.has(turn) ? "poll_window_missed" : "event_not_seen";
}
async function handleCandidate(turn, player, trig) {
  const entry = playerSeat(player);
  if (!entry) return;
  if (seatStopped(entry.civ)) { log("seat stopped, skipping " + turn + ":" + player); return; }
  const key = epochKey(S.gameId, turn, player);
  if (S.claimed[key]) { S.counters.duplicates++; S.counters.dupClaimed = (S.counters.dupClaimed ?? 0) + 1; saveState(); log("duplicate " + key); return; }
  trig.detectedAtMs = trig.detectedAtMs ?? Date.now();
  if (!Array.isArray(trig.collapsed)) trig.collapsed = [];
  if (busy) {
    if (queuedKeys.has(key)) { S.counters.duplicates++; S.counters.dupQueued = (S.counters.dupQueued ?? 0) + 1; saveState(); log("duplicate(queued) " + key); return; }
    for (let i = queue.length - 1; i >= 0; i--) {
      const q = queue[i];
      if (q.entry.seat !== entry.seat) continue;
      if (q.turn < turn) {
        queue.splice(i, 1);
        queuedKeys.delete(q.key);
        trig.collapsed.push(q.turn);
        log("collapsed queued " + q.key + " into " + key);
      } else {
        log("superseded stale " + key + " by queued " + q.key);
        return;
      }
    }
    queue.push({ key, entry, turn, trig });
    queuedKeys.add(key);
    log("queued " + key);
    return;
  }
  if (!claim(key, trig.source)) { log("duplicate " + key); return; }
  trig.claimedAt = new Date().toISOString();
  busy = true;
  try { await dispatch(entry, turn, trig); }
  finally {
    busy = false;
    const next = queue.shift();
    if (next) queuedKeys.delete(next.key);
    if (next && !stopped()) setImmediate(() => handleCandidate(next.turn, next.entry.player, next.trig));
    else if (next) log("dropped queued " + next.key + " (router stopping); needs explicit miss record");
  }
}
function onEventEnvelope(ev, data, nowMs) {
  let payload = null;
  try { payload = JSON.parse(data); } catch { return; }
  const items = Array.isArray(payload) ? payload : [payload];
  for (const it of items) {
    const type = it?.type ?? it?.event ?? ev ?? null;
    const p = it?.payload ?? it?.data ?? it?.extraPayload ?? null;
    if (!p || typeof p !== "object") continue;
    const pid = p.PlayerID ?? p.playerID ?? p.playerId;
    if (pid === undefined || pid === null) continue;
    // Native PlayerDoTurn carries PlayerID but no Turn. Derive the turn from
    // the last authoritative poll; the post-pause active-player check in
    // dispatch refuses the epoch if the derivation went stale.
    let t = Number(p.Turn ?? p.turn);
    let derived = false;
    if (!Number.isFinite(t)) {
      if (lastPollState && Number.isFinite(Number(lastPollState.turn))) {
        t = Number(lastPollState.turn);
        derived = true;
      } else {
        if (pendingEvents.length < 50) pendingEvents.push({ type: String(type), pid: Number(pid), at: nowMs });
        log("event " + type + " p" + pid + " parked (no poll baseline yet)");
        continue;
      }
    }
    if (TURN_EVENTS.includes(String(type))) {
      eventsSeenTurns.add(t);
      log("event " + type + " T" + t + " p" + pid + (derived ? " (turn derived from poll)" : ""));
      handleCandidate(t, Number(pid), { source: "event", playerID: Number(pid), eventType: String(type), sseAt: new Date(nowMs).toISOString(), detectedAtMs: nowMs });
    } else {
      log("unlisted turn-ish event " + type + " T" + t + " p" + pid);
    }
  }
}
async function pollOnce() {
  let st = null;
  try { st = await status(); } catch (e) { return; }
  // No game attached (backend up, Civ down): hold position. Never reset
  // claims on an empty ID and never dispatch into the void.
  if (!st.gameID) return;
  if (!S.gameId || st.gameID !== S.gameId) {
    S.gameId = st.gameID;
    S.claimed = {};
    saveState();
    log("tracking game " + st.gameID);
  }
  const prev = lastPollState;
  lastPollState = { turn: st.turn, active: st.activePlayerId };
  if (!prev) return;
  if (pendingEvents.length && Number.isFinite(Number(st.turn))) {
    const parked = pendingEvents.splice(0, pendingEvents.length);
    for (const pe of parked) {
      eventsSeenTurns.add(Number(st.turn));
      log("event " + pe.type + " T" + st.turn + " p" + pe.pid + " (flushed from park)");
      handleCandidate(Number(st.turn), Number(pe.pid), { source: "event", playerID: Number(pe.pid), eventType: pe.type, sseAt: new Date(pe.at).toISOString(), detectedAtMs: pe.at });
    }
  }
  if (st.turn !== prev.turn) checkMissed(st.turn);
  const changed = st.turn !== prev.turn || st.activePlayerId !== prev.active;
  if (!changed) return;
  const entry = playerSeat(st.activePlayerId);
  if (!entry) return;
  handleCandidate(st.turn, Number(st.activePlayerId), { source: "poll", playerID: Number(st.activePlayerId), pollAt: new Date().toISOString(), detectedAtMs: Date.now() });
}
function checkMissed(liveTurn) {
  for (const entry of seats) {
    if (seatStopped(entry.civ)) continue;
    const done = Math.max(loadCogState(entry.civ)?.lastSuccessfulDecisionTurn ?? -1, maxCommitted(entry.civ));
    for (let t = done + 1; t < liveTurn; t++) {
      const key = epochKey(S.gameId, t, entry.player);
      if (S.claimed[key]) continue;
      S.claimed[key] = { ts: new Date().toISOString(), source: "miss" };
      S.counters.misses++;
      saveState();
      appendSeatEpoch(entry.civ, { ts: new Date().toISOString(), kind: "missed_epoch", seat: entry.seat, gameID: S.gameId, missedTurn: t, liveTurn, reason: missReasonFor(t) });
      log("missed_epoch T" + t + " seat " + entry.seat);
    }
  }
}
async function streamEvents() {
  const res = await fetch(SSE_URL, { headers: { Accept: "text/event-stream" } });
  if (!res.ok || !res.body) throw new Error("sse connect failed");
  streamHealthy = true;
  log("stream connected");
  if (INJECT) {
    try {
      const inj = JSON.parse(INJECT);
      onEventEnvelope("inject", JSON.stringify(inj), Date.now());
    } catch (e) { log("inject parse failed"); }
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    if (stopped()) { try { await reader.cancel(); } catch {} streamHealthy = false; return; }
    const { done, value } = await reader.read();
    if (done) { streamHealthy = false; return; }
    buf += dec.decode(value, { stream: true }).split("\r\n").join("\n");
    let cut = buf.indexOf("\n\n");
    while (cut >= 0) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const lines = block.split("\n");
      const ev = (lines.find((l) => l.indexOf("event:") === 0) ?? "").slice(6).trim();
      for (const l of lines) {
        if (l.indexOf("data:") !== 0) continue;
        onEventEnvelope(ev, l.slice(5).trim(), Date.now());
      }
      cut = buf.indexOf("\n\n");
    }
  }
}
async function watch() {
  try { fs.unlinkSync(path.join(here, "run-lock.json")); log("retired run-lock.json"); }
  catch {}
  loadState();
  acquireLock();
  let backoff = 1000;
  const pollTimer = setInterval(() => { if (!stopped()) pollOnce().catch((e) => log("poll failed: " + e.message)); }, pollMs);
  log("router start game=" + game + " pollMs=" + pollMs + (NO_SSE ? " SSE-DISABLED" : ""));
  while (!stopped()) {
    if (!NO_SSE) {
      try {
        await streamEvents();
        if (stopped()) break;
        log("stream ended; reconnecting");
      } catch (e) { log("stream error: " + e.message); }
    } else {
      await new Promise((r) => setTimeout(r, 5000));
    }
    const wait = Math.min(backoff, 30000);
    backoff = Math.min(backoff * 2, 30000);
    const t0 = Date.now();
    while (Date.now() - t0 < wait && !stopped()) await new Promise((r) => setTimeout(r, 1000));
    if (stopped()) break;
    backoff = 1000;
  }
  clearInterval(pollTimer);
  try { await resumeNow(); log("resumed on exit"); } catch {}
  log("router stopped");
}
await watch();
