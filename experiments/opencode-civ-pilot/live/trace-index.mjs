// Merged chronological index across seat transcripts + epochs (spec 20).
// Usage: node trace-index.mjs [--game fresh1] > TRACE-FRESH1.md
// Read-only: parses transcript-live.md turn sections and epochs.jsonl.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const game = (process.argv.find((a) => a.startsWith("--game"))?.split("=")[1]) ?? "fresh1";
const SEATS = [
  { seat: 0, c: "morocco" }, { seat: 1, c: "ethiopia" },
  { seat: 2, c: "polynesia" }, { seat: 3, c: "sweden" },
];
const rows = [];
for (const { seat, c } of SEATS) {
  const dir = path.join(here, "runs-" + game + "-" + c);
  let epochs = [];
  try {
    epochs = fs.readFileSync(path.join(dir, "epochs.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {}
  let teles = [];
  try {
    teles = fs.readFileSync(path.join(dir, "telemetry-live.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {}
  const teleByTurn = new Map(teles.map((t) => [t.turn, t]));
  for (const e of epochs) {
    const turn = e.observationTurn ?? e.missedTurn ?? e.committedTurn ?? "-";
    const t = teleByTurn.get(turn) ?? teleByTurn.get(e.committedTurn);
    rows.push({
      ts: e.ts, civ: c, kind: e.kind ?? "cognition",
      turn, exit: e.exit ?? "-", committed: e.committedTurn ?? (e.missedTurn != null ? ("missed " + e.missedTurn) : "-"),
      trigger: e.triggerPlayerID ?? "-", active: e.activePlayerID ?? "-",
      collapsed: (e.collapsed ?? []).join(",") || "-",
      cogMs: e.cognitionMs ?? "-", pausedMs: e.pausedMs ?? "-",
      tools: t ? (t.tool_calls ?? []).filter((x, i, a) => a.indexOf(x) === i).join(",") : "-",
      ops: t?.communicates ?? "-",
      uncached: t?.uncached_input_tokens ?? "-", read: t?.cache_read_input_tokens ?? "-",
      out: t?.output_tokens ?? "-", reason: t?.reasoning_tokens ?? "-",
    });
  }
}
rows.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
console.log("# Chronological trace index: " + game);
console.log("");
console.log("| when | civ | kind | turn | exit | committed | trigger | active | collapsed | cogMs | pausedMs | tools | ops | uncached | cacheRead | out | reasoning |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  console.log("| " + [r.ts, r.civ, r.kind, r.turn, r.exit, r.committed, r.trigger, r.active, r.collapsed, r.cogMs, r.pausedMs, r.tools, r.ops, r.uncached, r.read, r.out, r.reason].join(" | ") + " |");
}
