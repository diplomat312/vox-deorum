// Trigger-win report (brief 12): event vs poll vs recovery, misses,
// duplicates, refusals across one game. Usage: node report-capture.mjs --game <name>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const game = (process.argv.find((a) => a.startsWith("--game"))?.split("=")[1]) ?? null;
if (!game) { console.error("usage: report-capture.mjs --game <name>"); process.exit(2); }
let router = null;
try { router = JSON.parse(fs.readFileSync(path.join(here, "router-state-" + game + ".json"), "utf8")); }
catch {}
const agg = { eventWins: 0, pollWins: 0, recoveryWins: 0, missed: 0, duplicates: 0, refusals: 0, cognitions: 0, commits: 0 };
const perSeat = {};
for (const dir of fs.readdirSync(here)) {
  const m = new RegExp("^runs-" + game + "-(.+)$").exec(dir);
  if (!m) continue;
  const civ = m[1];
  const rows = { cognitions: 0, commits: 0, missed: 0, refused: 0, bySource: {} };
  try {
    for (const line of fs.readFileSync(path.join(here, dir, "epochs.jsonl"), "utf8").split("\n")) {
      if (!line.trim()) continue;
      const e = JSON.parse(line);
      if (e.kind === "missed_epoch") { rows.missed++; agg.missed++; continue; }
      if (e.kind === "refused") { rows.refused++; agg.refusals++; continue; }
      // Boot-reconciliation records: recovered is an orphan that completed
      // (telemetry holds it), interrupted is a lost opportunity in the
      // missed family.
      if (e.kind === "recovered") { rows.cognitions++; agg.cognitions++; rows.commits++; agg.commits++; continue; }
      if (e.kind === "interrupted") { rows.missed++; agg.missed++; continue; }
      if (e.kind && e.kind !== "cognition") continue;
      rows.cognitions++;
      agg.cognitions++;
      if (e.exit === 0) { rows.commits++; agg.commits++; }
      const s = e.wakeSource ?? e.triggerSource ?? "unknown";
      rows.bySource[s] = (rows.bySource[s] ?? 0) + 1;
      agg[s === "event" ? "eventWins" : s === "poll" ? "pollWins" : "recoveryWins"]++;
    }
  } catch {}
  perSeat[civ] = rows;
}
if (router?.counters) {
  agg.duplicates = router.counters.duplicates ?? agg.duplicates;
  agg.refusals = Math.max(agg.refusals, router.counters.refusals ?? 0);
}
console.log("capture report game=" + game);
console.log(JSON.stringify({ perSeat, total: agg }, null, 1));
