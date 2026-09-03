import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorld } from "./world.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const pilotDir = path.resolve(here, "..");
function arg(name, dflt) {
  const i = process.argv.indexOf("--" + name);
  return i >= 0 ? (process.argv[i + 1] || dflt) : dflt;
}
const rundir = path.resolve(pilotDir, arg("rundir", "runs/2p-game"));
const game = arg("game", "2p-1");
const model = arg("model", "opencode-go/muse-spark-1.3-contributor");
let turnsLeft = parseInt(arg("turns", "8"), 10);
const logFile = path.join(rundir, "ai-game.log");
const log = (m) => { const line = "[" + new Date().toISOString() + "] " + m + "\n"; fs.appendFileSync(logFile, line); console.log(m); };
function oneTurn(civ, worldTurn) {
  log("--- " + civ + " turn " + worldTurn + " ---");
  const env = Object.assign({}, process.env, { CIV_PILOT_GAME: game });
  const r = spawnSync("node", ["driver/run-civ-turn.mjs", "--rundir", rundir, "--civ", civ, "--game", game, "--turn", String(worldTurn), "--model", model], { cwd: pilotDir, env: env, encoding: "utf8", timeout: 420000 });
  if (r.stdout) fs.appendFileSync(logFile, r.stdout + "\n");
  if (r.stderr) fs.appendFileSync(logFile, "STDERR: " + r.stderr + "\n");
  if (r.status !== 0) { log(civ + " turn FAILED (exit " + r.status + ")"); return false; }
  log(civ + " turn done");
  return true;
}
log("AI game start: " + turnsLeft + " full turns, game=" + game);
while (turnsLeft > 0) {
  const w = loadWorld(rundir);
  const t = w.turn;
  if (!w.moved.Rome) { if (!oneTurn("Rome", t)) break; }
  const w2 = loadWorld(rundir);
  if (!w2.moved.Greece) { if (!oneTurn("Greece", w2.turn)) break; }
  const w3 = loadWorld(rundir);
  if (w3.turn === t && (w3.moved.Rome || w3.moved.Greece)) { log("turn " + t + " did not advance; stopping"); break; }
  log("world turn now " + w3.turn);
  if (w3.turn > t) turnsLeft--;
}
log("AI game loop finished");
