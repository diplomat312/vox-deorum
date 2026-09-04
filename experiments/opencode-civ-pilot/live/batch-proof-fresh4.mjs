// Fresh4 batched social exchange proof: ONE executeOperations call carrying
// four operations as Korea (seat 0): DM Austria, DM Siam, group update to a
// {0,1,2} coalition (Iroquois excluded), world post. Tagged BATCH4-*.
// Setup (group create/invite/accept) is operator-driven and logged as such;
// the four-operation batch is the proof. Verifies transport routing directly.
import { executeOperations } from "../driver/social-exec.mjs";
import { loadSeats } from "../driver/seats.mjs";
import { callLive, liveText } from "./live-mcp.mjs";
const turnRes = await fetch("http://127.0.0.1:5000/lua/execute", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ script: "return Game.GetGameTurn()" }),
});
const turnJson = await turnRes.json();
const turn = turnJson?.result;
console.log("live turn:", turn);
const seats = loadSeats();
const transports = {
  broadcast: async (text) => liveText(await callLive("broadcast-message", { PlayerID: 0, Content: text })),
  pair: async (peer, text) => { await callLive("append-message", { PlayerAID: Math.min(0, peer), PlayerBID: Math.max(0, peer), PlayerARole: "strategist", PlayerBRole: "strategist", SpeakerID: 0, MessageType: "text", Content: text }); },
};
// Setup: coalition group {0,1,2}, explicit invites + accepts (operator-driven).
const created = await executeOperations([{ channel: "group:create:Coalition", message: "BATCH4-SETUP" }], { me: 0, turn, seats, transports });
const createdCh = String(created.results[0]?.channel ?? "");
const gid = createdCh.indexOf("group:") === 0 ? createdCh.slice(6) : null;
console.log("group created:", JSON.stringify(created.results[0]).slice(0, 300));
if (!gid) { console.error("FAIL: no group id"); process.exit(1); }
for (const s of [1, 2]) {
  await executeOperations([{ channel: "group:invite:" + gid + ":" + s, message: "BATCH4-INVITE-" + s }], { me: 0, turn, seats, transports });
  await executeOperations([{ channel: "group:accept:" + gid, message: "BATCH4-ACCEPT-" + s }], { me: s, turn, seats, transports });
  console.log("seat " + s + " invited+accepted");
}
// Proof: one batched call, four operations.
const out = await executeOperations([
  { channel: "dm:1", message: "BATCH4-KOREA-AUSTRIA" },
  { channel: "dm:2", message: "BATCH4-KOREA-SIAM" },
  { channel: "group:" + gid, message: "BATCH4-COALITION" },
  { channel: "world", message: "BATCH4-WORLD-KOREA" },
], { me: 0, turn, seats, transports });
console.log("executed:", out.executed);
console.log(JSON.stringify(out.results, null, 1).slice(0, 1500));
// Verify routing: read world + pair threads, assert tag placement.
const gm = liveText(await callLive("get-global-messages", { Limit: 30 }));
const worldText = JSON.stringify(gm?.messages ?? gm ?? "");
const thread = async (a, b) => {
  const trd = await callLive("read-transcript", { PlayerAID: Math.min(a, b), PlayerBID: Math.max(a, b), Limit: 30 });
  return JSON.stringify(trd?.structuredContent ?? trd ?? "");
};
const t01 = await thread(0, 1);
const t02 = await thread(0, 2);
const t03 = await thread(0, 3);
const checks = [
  ["world has BATCH4-WORLD-KOREA", worldText.includes("BATCH4-WORLD-KOREA")],
  ["pair(0,1) has DM tag", t01.includes("BATCH4-KOREA-AUSTRIA")],
  ["pair(0,1) has group tag", t01.includes("BATCH4-COALITION")],
  ["pair(0,2) has DM tag", t02.includes("BATCH4-KOREA-SIAM")],
  ["pair(0,2) has group tag", t02.includes("BATCH4-COALITION")],
  ["pair(0,3) lacks DM tags", !t03.includes("BATCH4-KOREA-AUSTRIA") && !t03.includes("BATCH4-KOREA-SIAM")],
  ["pair(0,3) lacks group content", !t03.includes("BATCH4-COALITION")],
];
let fail = 0;
for (const [name, ok] of checks) { console.log((ok ? "PASS" : "FAIL") + ": " + name); if (!ok) fail++; }
console.log("group id for observation check:", gid);
process.exit(fail ? 1 : 0);
