// Re-send the fresh4 batch with a live turn stamp so the next cognition of
// each seat picks it up via the Turn > lastSeenTurn delta. Reuses coalition
// group 096ef627 (members 0,1,2 accepted). Tagged BATCH4B-*.
import { executeOperations } from "../driver/social-exec.mjs";
import { loadSeats } from "../driver/seats.mjs";
import { callLive, liveText } from "./live-mcp.mjs";
const turnRes = await fetch("http://127.0.0.1:5000/lua/execute", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ script: "return Game.GetGameTurn()" }),
});
const turn = (await turnRes.json())?.result;
console.log("live turn:", turn);
const seats = loadSeats();
const transports = {
  broadcast: async (text) => liveText(await callLive("broadcast-message", { PlayerID: 0, Content: text })),
  pair: async (peer, text) => { await callLive("append-message", { PlayerAID: Math.min(0, peer), PlayerBID: Math.max(0, peer), PlayerARole: "strategist", PlayerBRole: "strategist", SpeakerID: 0, MessageType: "text", Content: text }); },
};
const out = await executeOperations([
  { channel: "dm:1", message: "BATCH4B-KOREA-AUSTRIA" },
  { channel: "dm:2", message: "BATCH4B-KOREA-SIAM" },
  { channel: "group:096ef627", message: "BATCH4B-COALITION" },
  { channel: "world", message: "BATCH4B-WORLD-KOREA" },
], { me: 0, turn, seats, transports });
console.log("executed:", out.executed, "turn:", turn);
