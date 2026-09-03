// Operator-driven multi-operation batch proof (spec 15): ONE executeOperations
// call carrying four operations as seat 0 at the live turn. Tagged strings.
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
const transports = {
  broadcast: async (text) => liveText(await callLive("broadcast-message", { PlayerID: 0, Content: text })),
  pair: async (peer, text) => { await callLive("append-message", { PlayerAID: Math.min(0, peer), PlayerBID: Math.max(0, peer), PlayerARole: "strategist", PlayerBRole: "strategist", SpeakerID: 0, MessageType: "text", Content: text }); },
};
const out = await executeOperations([
  { channel: "dm:1", message: "BATCH15-MOROCCO-ETHIOPIA" },
  { channel: "dm:3", message: "BATCH15-MOROCCO-SWEDEN" },
  { channel: "group:a149b4fe", message: "BATCH15-WAR-COUNCIL" },
  { channel: "world", message: "BATCH15-WORLD-MOROCCO" },
], { me: 0, turn, seats: loadSeats(), transports });
console.log("executed:", out.executed);
console.log(JSON.stringify(out.results, null, 1).slice(0, 2000));
