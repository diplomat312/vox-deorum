// One-off: chronological list of all model-sent social operations per seat.
import fs from "node:fs";
const names = ["Korea", "Austria", "Siam", "Iroquois"];
const civs = ["korea", "austria", "siam", "iroquois"];
for (const civ of civs) {
  const dir = "runs-fresh4-" + civ;
  let text = "";
  try { text = fs.readFileSync(dir + "/tool-calls.jsonl", "utf8"); } catch { continue; }
  for (const line of text.split("\n")) {
    if (line.indexOf('"tool":"communicate"') < 0) continue;
    try {
      const e = JSON.parse(line);
      const args = JSON.parse(e.args);
      const ops = args.operations && args.operations.length ? args.operations : [{ channel: args.channel, message: args.message }];
      for (const op of ops) console.log("T" + e.turn + " " + names[e.seat] + " -> " + op.channel + ": " + String(op.message).slice(0, 140));
    } catch {}
  }
}
