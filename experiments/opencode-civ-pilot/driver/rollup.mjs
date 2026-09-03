// Run-level and per-seat telemetry rollup.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const NL = String.fromCharCode(10);
const dirs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const asJson = process.argv.includes("--json");
const roots = dirs.length ? dirs : fs.readdirSync(path.join(here, "..", "live")).filter((n) => n.startsWith("runs-")).map((n) => path.join(here, "..", "live", n));
const per = {};
for (const d of roots) {
  const rows = rowsOf(d);
  if (!rows.length) continue;
  per[d] = { civ: rows[rows.length - 1].civ, ...agg(rows) };
}
const all = Object.keys(per).flatMap((d) => rowsOf(d));
const total = agg(all);
if (asJson) { console.log(JSON.stringify({ per, total }, null, 1)); process.exit(0); }
for (const d of Object.keys(per)) {
  const t = per[d];
  console.log(d + ": turns=" + t.turns + " commits=" + t.commits + " hit=" + t.hitRatio.toFixed(3) + " out=" + t.output + " ops=" + t.ops);
}
console.log("TOTAL turns=" + total.turns + " commits=" + total.commits + " hit=" + total.hitRatio.toFixed(3) + " out=" + total.output + " ops=" + total.ops);
function rowsOf(dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, "telemetry-live.jsonl"), "utf8");
    return raw.split(NL).filter(Boolean).map((l) => JSON.parse(l));
  } catch (e) { return []; }
}
function agg(rows) {
  const t = { turns: 0, commits: 0, uncached: 0, read: 0, write: 0, output: 0, reasoning: 0, latencyMs: 0, ops: 0, timeouts: 0, nudges: 0 };
  for (const r of rows) {
    t.turns += 1;
    if (r.commit_ok) t.commits += 1;
    t.uncached += r.uncached_input_tokens || 0;
    t.read += r.cache_read_input_tokens || 0;
    t.write += r.cache_write_input_tokens || 0;
    t.output += r.output_tokens || 0;
    t.reasoning += r.reasoning_tokens || 0;
    t.latencyMs += r.latency_ms || 0;
    t.ops += r.communicates || 0;
    if (r.timed_out) t.timeouts += 1;
    if (r.nudged) t.nudges += 1;
  }
  const denom = t.read + t.uncached + t.write;
  t.hitRatio = denom ? t.read / denom : 0;
  t.commitRate = t.turns ? t.commits / t.turns : 0;
  return t;
}
