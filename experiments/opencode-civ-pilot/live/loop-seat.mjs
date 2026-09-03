// Turn-gated supervisor loop for one seat (brief: monitor Spain). Each cycle:
// wait for the seat turn, pause the game, run one cognition opportunity,
// resume on commit (or on timeout, so a stuck mind never holds the game
// hostage). Only commit_ok advances the done watermark, so a failed turn is
// retried next cycle. Stop by creating STOP in the rundir.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callLive } from "./live-mcp.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
function arg(name, dflt = null) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? (process.argv[i + 1] ?? dflt) : dflt;
}
const seat = Number(arg("seat", NaN));
const game = arg("game", "fourway-spain");
const rundirArg = arg("rundir", null);
const pollMs = Number(arg("poll-ms", 15000));
const runBudgetMs = Number(arg("run-budget-ms", 12 * 60 * 1000));
if (!Number.isInteger(seat) || !rundirArg) { console.error("usage: loop-seat.mjs --seat N --rundir ABS [--game g]"); process.exit(2); }
const rundir = path.isAbsolute(rundirArg) ? rundirArg : path.resolve(process.cwd(), rundirArg);
fs.mkdirSync(rundir, { recursive: true });
const stopf = path.join(rundir, "STOP");
const logf = path.join(rundir, "loop-seat-" + seat + ".log");
function log(m) { fs.appendFileSync(logf, new Date().toISOString() + " " + m + "\n"); }
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
log("loop start seat " + seat);
while (!fs.existsSync(stopf)) {
  let st = null;
  try { st = await status(); } catch (e) { await new Promise((r) => setTimeout(r, pollMs)); continue; }
  if (st.activePlayerId === seat && st.turn > doneTurn) {
    log("seat turn " + st.turn + " pausing");
    await pause();
    const res = await runOnce(st.turn);
    log("turn " + st.turn + " exit " + res.code);
    if (res.code === 0) doneTurn = st.turn;
    await resume();
  } else {
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
log("loop stopped");
