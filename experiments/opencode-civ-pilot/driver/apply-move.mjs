// Applies a move file for any civ (used by the Codex player for Greece,
// and for manual fixes). Move file JSON:
//   { "actions": [{type, params?}], "rationale": "...", "messageTo": "Rome", "message": "..." }
// Usage: node driver/apply-move.mjs --rundir runs/2p-game --civ Greece --move-file my-move.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorld, saveWorld, recordCommit, maybeAdvance, nextUp, queueMessage } from "./world.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pilotDir = path.resolve(here, "..");

function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? dflt) : dflt;
}

const rundir = path.resolve(pilotDir, arg("rundir", "runs/2p-game"));
const civ = arg("civ", "Greece");
const moveFile = arg("move-file", null);
if (!moveFile) { console.error("missing --move-file"); process.exit(2); }
const move = JSON.parse(fs.readFileSync(path.resolve(moveFile), "utf8"));
if (!Array.isArray(move.actions)) { console.error("move file needs an actions array"); process.exit(2); }
if (typeof move.rationale !== "string" || move.rationale.length < 3) { console.error("move file needs a rationale"); process.exit(2); }

const w = loadWorld(rundir);
const turnStarted = w.turn;
if (move.messageTo && move.message) {
  if (!queueMessage(w, civ, move.messageTo, move.message)) { console.error(`message target '${move.messageTo}' unknown`); process.exit(2); }
}
recordCommit(w, civ, { ...move, by: "codex" });
const advanced = maybeAdvance(w);
saveWorld(rundir, w);
fs.appendFileSync(path.join(rundir, "transcript-2p.md"),
  `\n\n## ${civ} turn ${turnStarted} (codex)\n\n### Commit\n\n${JSON.stringify(move, null, 2)}\n\nWorld advanced: ${advanced}. Next up: ${nextUp(w) ?? "turn " + w.turn + " (both moved)"}.\n`);
console.log(JSON.stringify({ civ, turn: turnStarted, commit_ok: true, advanced, nextUp: nextUp(w), worldTurn: w.turn }, null, 2));
