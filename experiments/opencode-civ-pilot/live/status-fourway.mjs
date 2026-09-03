// Read-only operator status for the live four-seat run (spec 24).
// Usage: node status-fourway.mjs [--game fresh1]
// Prints game state plus per-seat loop/session/commit health. Writes nothing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const game = (process.argv.find((a) => a.startsWith("--game"))?.split("=")[1]) ?? "fresh1";
const SEATS = [
  { seat: 0, c: "morocco" }, { seat: 1, c: "ethiopia" },
  { seat: 2, c: "polynesia" }, { seat: 3, c: "sweden" },
];
async function jget(url, ms = 8000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal }); return await r.json(); }
  finally { clearTimeout(t); }
}
async function lua(script, ms = 12000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch("http://127.0.0.1:5000/lua/execute", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script }), signal: c.signal,
    });
    return await r.json();
  } finally { clearTimeout(t); }
}
function tail(f, n = 3) {
  try { const l = fs.readFileSync(f, "utf8").trim().split("\n"); return l.slice(-n); }
  catch { return ["(no log)"]; }
}
function lastJson(f) {
  try { const l = fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean); return JSON.parse(l[l.length - 1]); }
  catch { return null; }
}
function mtime(f) {
  try { return fs.statSync(f).mtime.toISOString(); } catch { return "-"; }
}
console.log("game:", game);
try {
  const h = await jget("http://127.0.0.1:5000/health");
  console.log("bridge: dll=" + h?.result?.dll_connected + " uptime=" + h?.result?.uptime);
  const s = await jget("http://127.0.0.1:5000/stats");
  console.log("bridge-stats: pendingRequests=" + s?.result?.dll?.pendingRequests + " sseClients=" + s?.result?.sse?.activeClients);
} catch (e) { console.log("bridge: UNREACHABLE " + e.message); }
try {
  const t = await lua("return {turn=Game.GetGameTurn(), active=Game.GetActivePlayer()}");
  console.log("civ: turn=" + t?.result?.turn + " activePlayer=" + t?.result?.active);
} catch (e) { console.log("civ: turn query failed (" + e.message + ")"); }
let lock = null;
try { lock = JSON.parse(fs.readFileSync(path.join(here, "run-lock.json"), "utf8")); } catch {}
console.log("serial-lock:", lock ? ("seat " + lock.seat + " turn " + lock.turn + " since " + lock.at) : "free");
for (const { seat, c } of SEATS) {
  const dir = path.join(here, "runs-" + game + "-" + c);
  const ep = lastJson(path.join(dir, "epochs.jsonl"));
  const tele = lastJson(path.join(dir, "telemetry-live.jsonl"));
  const logTail = tail(path.join(dir, "loop-seat-" + seat + ".log"), 1)[0];
  const thinking = lock && Number(lock.seat) === seat ? "yes" : "no";
  console.log(["seat " + seat + " (" + c + ")",
    "loopLog=" + mtime(path.join(dir, "loop-seat-" + seat + ".log")),
    "thinking=" + thinking,
    "session=" + (tele?.sessionId ?? "-"),
    "lastCommit=" + (ep?.committedTurn ?? ("FAILED exit=" + ep?.exit)),
    "lastExit=" + ep?.exit,
    "log=" + logTail.slice(0, 90)].join(" | "));
}
