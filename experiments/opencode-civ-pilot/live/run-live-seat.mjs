// One LIVE cognition opportunity for ANY seat in the Civ pilot duel.
//
// Thin seat-aware front door over run-live-turn.mjs: resolves the seat's civ /
// leader / playerID / rival + session + state file from social-seats.json and the
// per-seat civ-state file, then spawns run-live-turn.mjs with sized env overrides.
// Same driver, same observation shape, same OpenCode harness for every seat.
//
// Usage: node run-live-seat.mjs --seat 0 --turn 208 --rundir ABS(live/runs-portugal) --game live-duel
//   [--session <id-to-resume>] [--model <model>]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const seatsPath = process.env.CIV_PILOT_SEATS_FILE || path.join(here, "social-seats.json");

function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? dflt) : dflt;
}

const seat = Number(arg("seat", NaN));
if (!Number.isInteger(seat)) {
  console.error("pass --seat <N>");
  process.exit(2);
}
const turn = Number(arg("turn", NaN));
if (!Number.isFinite(turn)) {
  console.error("pass --turn <live game turn>");
  process.exit(2);
}
const game = arg("game", "live-duel");
const rundirArg = arg("rundir", `runs/seat-${seat}`);
const rundir = path.isAbsolute(rundirArg) ? rundirArg : path.resolve(process.cwd(), rundirArg);
const sessionArg = arg("session", null);
const modelArg = arg("model", process.env.CIV_PILOT_MODEL ?? null);

let seats = [];
try {
  seats = JSON.parse(fs.readFileSync(seatsPath, "utf8"));
} catch (e) {
  console.error(`cannot read seats config ${seatsPath}: ${e.message}`);
  process.exit(2);
}
const cfg = seats.find((s) => Number(s.seat) === seat);
if (!cfg) {
  console.error(`seat ${seat} not found in ${seatsPath}`);
  process.exit(2);
}
const stateFile = process.env.CIV_PILOT_STATE_FILE || path.join(here, `civ-state-${seat}.json`);
let state = {};
try { state = JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch { /* first run */ }
const rival = seats.find((s) => Number(s.seat) !== seat) ?? { seat: 1 - seat };

const env = {
  ...process.env,
  CIV_PILOT_CIV: cfg.civ,
  CIV_PILOT_LEADER: cfg.leader,
  CIV_PILOT_PLAYER_ID: String(seat),
  CIV_PILOT_RIVAL_ID: String(rival.seat),
  CIV_PILOT_RIVAL_CIV: rival.civ,
  CIV_PILOT_RIVAL_LEADER: rival.leader,
  CIV_PILOT_STATE_FILE: stateFile,
  CIV_PILOT_COMMIT_BASENAME: `last-commit-seat-${seat}.json`,
  ...(modelArg ? { CIV_PILOT_MODEL: modelArg } : {}),
};

const args = ["run-live-turn.mjs", "--turn", String(turn), "--rundir", rundir, "--game", game];
if (sessionArg) args.push("--session", sessionArg);

const child = spawn("node", args, { cwd: here, env, stdio: "inherit" });
child.on("error", (e) => { console.error("spawn failed:", e.message); process.exit(1); });
child.on("close", (code) => {
  // run-live-turn.mjs exits 0 only when the turn is committed (commit_ok).
  process.exit(code === null ? 1 : code);
});

