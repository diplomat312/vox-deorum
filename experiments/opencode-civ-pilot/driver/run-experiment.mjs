// Phase 1+2 loop: SAME session across N turns. Usage:
//   node driver/run-experiment.mjs --turns 20 --civ Rome --leader "Augustus Caesar"
// Optional phase-3 poke: --diplo-at 12 --diplo-from Germany --diplo-msg "..."
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { summarize } from "./telemetry.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? dflt) : dflt;
}
const turns = Number(arg("turns", "20"));
const civ = arg("civ", "Rome");
const leader = arg("leader", "Augustus Caesar");
const game = arg("game", "pilot-1");
const model = arg("model", "opencode-go/muse-spark-1.3-contributor");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = arg("rundir", path.join(here, "..", "runs", `exp-${stamp}`));
const diploAt = Number(arg("diplo-at", "-1"));
const diploFrom = arg("diplo-from", "Germany");
const diploMsg = arg("diplo-msg", "Rome, join us against Greece and we will support you in the future World Congress.");
fs.mkdirSync(runDir, { recursive: true });

let session = null;
for (let t = 1; t <= turns; t++) {
  const a = ["driver/run-turn.mjs", "--civ", civ, "--leader", leader,
    "--turn", String(t), "--seq", String(t), "--game", game,
    "--model", model, "--rundir", runDir];
  if (session) a.push("--session", session);
  if (t === diploAt) a.push("--diplo-from", diploFrom, "--diplo-msg", diploMsg);
  console.log(`\n===== turn ${t}/${turns} =====`);
  const r = spawnSync("node", a, { cwd: path.join(here, ".."), stdio: "inherit", shell: false });
  if (r.status !== 0) { console.error(`turn ${t} failed with code ${r.status}; stopping.`); break; }
  try {
    const tele = path.join(runDir, "telemetry.jsonl");
    const rows = fs.readFileSync(tele, "utf8").trim().split("\n").map(JSON.parse);
    session = rows[rows.length - 1].sessionId ?? session;
  } catch {}
}
const summary = summarize(path.join(runDir, "telemetry.jsonl"));
fs.writeFileSync(path.join(runDir, "summary.json"), JSON.stringify({ game, civ, model, session, summary }, null, 2));
console.log("\n===== SUMMARY =====");
console.log(JSON.stringify(summary, null, 2));
console.log(`run dir: ${runDir}`);
