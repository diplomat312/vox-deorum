// Prefix-stability guard for the cache experiment.
//
// Everything the model sees BEFORE the first observation is provider-prefix:
//   - agent/civ.md            (agent identity / instructions)
//   - opencode.json           (model, agent, permission/skill advertisement)
//   - vox-civ tool schemas    (names, descriptions, input schemas)
// Changing any of these costs a one-time ~100k-token cache miss on the live
// Siam session (seen T145 deal-social, T156 deal-v1). Dashboard text and
// inspect RESULT content are suffix: freely tunable, marginal per-turn cost.
//
// Usage:
//   node live/check-prefix.mjs            # fail if prefix drifted
//   node live/check-prefix.mjs --update   # re-baseline after a DELIBERATE,
//                                         # batched, model-visible change
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fingerprintFile = path.join(here, "prefix-fingerprint.txt");

function sha(b) {
  return crypto.createHash("sha256").update(b).digest("hex").slice(0, 16);
}

// Boot the pilot MCP server over stdio and read its REAL advertised schemas
// (robust to refactors: we hash what the model actually sees, not source).
function listPilotTools() {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [path.join(here, "vox-live-server.mjs")], {
      stdio: ["pipe", "pipe", "inherit"],
    });
    let buf = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("pilot server ListTools timed out"));
    }, 15000);
    child.stdout.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg = null;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 2 && msg.result?.tools) {
          clearTimeout(timer);
          child.kill();
          resolve(msg.result.tools);
        }
      }
    });
    child.on("error", reject);
    const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "check-prefix", version: "1" } } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });
}

const tools = await listPilotTools();
const parts = [
  "civ.md=" + sha(fs.readFileSync(path.join(here, "agent", "civ.md"))),
  "opencode.json=" + sha(fs.readFileSync(path.join(here, "opencode.json"))),
  "tools=" + sha(JSON.stringify(tools)),
];
const fingerprint = parts.join("\n") + "\n";

if (process.argv.includes("--update")) {
  const NL = String.fromCharCode(10);
const at = process.argv.indexOf("--update");
const reason = process.argv.slice(at + 1).join(" ").trim();
const stamped = fingerprint + "updated=" + new Date().toISOString() + NL + (reason ? "reason=" + reason + NL : "");
fs.writeFileSync(fingerprintFile, stamped);
  console.log("prefix fingerprint updated:\n" + fingerprint);
  process.exit(0);
}

let expected = null;
try {
  expected = fs.readFileSync(fingerprintFile, "utf8");
} catch {
  console.error("no prefix fingerprint yet; run with --update to baseline.");
  process.exit(2);
}
if (expected !== fingerprint) {
  console.error("MODEL-VISIBLE PREFIX DRIFTED (expect a one-time ~100k cache miss):");
  console.error("--- expected ---\n" + expected + "--- actual ---\n" + fingerprint);
  process.exit(1);
}
console.log("prefix stable:\n" + fingerprint);
