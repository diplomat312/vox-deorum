// Four-way privacy and routing smoke test (offline).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
const NL = String.fromCharCode(10);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "civ-fourway-"));
const regFile = path.join(tmp, "channels.json");
const opsFile = path.join(tmp, "ops.json");
const worldFile = path.join(tmp, "world.json");
const seatsFile = path.join(tmp, "seats.json");
const commitDir = path.join(tmp, "commits");
fs.mkdirSync(commitDir, { recursive: true });
const civs = ["Alfa", "Bravo", "Charlie", "Delta"];
fs.writeFileSync(seatsFile, JSON.stringify(civs.map((civ, seat) => ({ seat, civ, leader: civ, playedBy: "opencode" }))));
const world = { turn: 700, civs: {}, events: [], inbox: {}, log: [] };
for (const civ of civs) { world.civs[civ] = { leader: civ }; world.inbox[civ] = []; }
fs.writeFileSync(worldFile, JSON.stringify(world));
let pass = 0;
function ok(cond, name) {
  if (cond === false) { console.error("FAIL: " + name); process.exit(1); }
  pass = pass + 1;
  console.log("ok: " + name);
}
function seatEnv(seat) {
  return { ...process.env, CIV_PILOT_PLAYER_ID: String(seat), CIV_PILOT_CIV: civs[seat], CIV_PILOT_TURN: "700", CIV_PILOT_CHANNELS_FILE: regFile, CIV_PILOT_OPS_FILE: opsFile, CIV_PILOT_WORLD_FILE: worldFile, CIV_PILOT_SEATS_FILE: seatsFile, CIV_PILOT_COMMIT_FILE: path.join(commitDir, "c" + seat + ".json") };
}
function callMock(payloads, seat) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["../mcp-server/index.mjs"], { cwd: "live", stdio: ["pipe", "pipe", "inherit"], env: seatEnv(seat) });
    let buf = "";
    const out = [];
    const timer = setTimeout(() => { child.kill(); reject(new Error("fourway timed out")); }, 25000);
    child.stdout.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split(NL);
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg = null;
        try { msg = JSON.parse(line); } catch (e) { continue; }
        if (msg.id !== undefined && msg.id !== 1) out.push(msg);
        if (out.length === payloads.length) { clearTimeout(timer); child.kill(); resolve(out); }
      }
    });
    child.on("error", reject);
    const send = (o) => child.stdin.write(JSON.stringify(o) + NL);
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "fw", version: "1" } } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    let id = 2;
    for (const p of payloads) { send({ jsonrpc: "2.0", id: id, method: "tools/call", params: p }); id = id + 1; }
  });
}
function isErr(m) { return !!(m && m.result && m.result.isError); }
function textOf(m) { return String((m && m.result && m.result.content && m.result.content[0] && m.result.content[0].text) || ""); }
function bodyOf(m) { try { return JSON.parse(textOf(m)); } catch (e) { return {}; } }
const created = await callMock([{ name: "communicate", arguments: { operations: [{ channel: "group:create:War Council", message: "forming" }] } }], 0);
ok(!isErr(created[0]), "seat 0 creates a group");
const G = bodyOf(created[0]).results[0].channel.split(":")[1];
ok(typeof G === "string" && G.length === 8, "group id returned");
const batch = await callMock([{ name: "communicate", arguments: { operations: [
  { channel: "group:invite:" + G + ":1", message: "join us" },
  { channel: "group:invite:" + G + ":2", message: "join us" },
  { channel: "dm:3", message: "stay out of it" },
  { channel: "world", message: "hello all" },
  { channel: "group:" + G, message: "war council convenes" },
  { channel: "group:create:Side Room", message: "later" },
  { channel: "dm:1", message: "psst" }
] } }], 0);
const bb = bodyOf(batch[0]);
ok(bb.executed === 7 && bb.results.every((r) => r.ok), "seven operations in one call");
const ninth = await callMock([{ name: "communicate", arguments: { channel: "world", message: "one more" } }], 0);
ok(isErr(ninth[0]) && textOf(ninth[0]).indexOf("budget") >= 0, "ninth operation rejected");
for (const seat of [1, 2, 3]) {
  const r = await callMock([{ name: "communicate", arguments: { channel: "world", message: "seat " + seat + " here" } }], seat);
  ok(!isErr(r[0]), "seat " + seat + " operates in the same turn");
}
process.env.CIV_PILOT_CHANNELS_FILE = regFile;
const ch = await import("./channels.mjs");
const w = JSON.parse(fs.readFileSync(worldFile, "utf8"));
console.log("world lines: " + w.log.length);
const lines = w.log.map((text, idx) => ({ Content: text, Turn: 700, ID: idx, SpeakerID: 0 }));
const v0 = ch.groupInbox(0, lines, 699);
const v1 = ch.groupInbox(1, lines, 699);
const v2 = ch.groupInbox(2, lines, 699);
const v3 = ch.groupInbox(3, lines, 699);
const seen0 = v0.lines.join();
const seen3 = v3.lines.join();
ok(seen0.indexOf(G) >= 0, "creator sees the group");
ok(seen3.indexOf(G) < 0, "outsider view hides the room");
ok(v1.invites.join().indexOf(G) >= 0, "invitee sees the invite");
function boxText(civ) {
  const box = w.inbox[civ] || [];
  return box.map((m) => m.text).join();
}
ok(boxText("Delta").indexOf("stay out of it") >= 0, "dm reaches its target");
ok(boxText("Alfa").indexOf("stay out of it") < 0, "dm hidden from sender inbox");
ok(boxText("Bravo").indexOf("stay out of it") < 0, "dm hidden from others");
ok(boxText("Bravo").indexOf("psst") >= 0, "second dm routed exactly");
ok(boxText("Charlie").indexOf("psst") < 0, "second dm not leaked");
console.log("All " + pass + " fourway asserts passed.");
