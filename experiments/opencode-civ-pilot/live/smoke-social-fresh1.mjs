// Operator-driven live social smoke test for game fresh1 (transport only,
// no seat budgets spent). Tagged strings verify routing + privacy per seat.
// Usage: CIV_PILOT_CHANNELS_FILE=channels-fresh1.json node smoke-social-fresh1.mjs
import { callLive, liveText } from "./live-mcp.mjs";
import { createGroup, inviteToGroup, resolveInvite, tagMessage } from "./channels.mjs";
async function pair(a, b, speaker, text) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  await callLive("append-message", { PlayerAID: lo, PlayerBID: hi, PlayerARole: "strategist", PlayerBRole: "strategist", SpeakerID: speaker, MessageType: "text", Content: text });
}
const WORLD = "WORLD-MOROCCO-TEST";
const DM01 = "DM-MOROCCO-ETHIOPIA";
const DM12 = "DM-ETHIOPIA-POLYNESIA";
const GROUPMSG = "GROUP-MOROCCO-ETHIOPIA-SWEDEN";
await callLive("broadcast-message", { PlayerID: 0, Content: WORLD });
console.log("world sent");
await pair(0, 1, 0, DM01);
console.log("dm 0->1 sent");
await pair(1, 2, 1, DM12);
console.log("dm 1->2 sent");
const g = createGroup({ title: "War Council", creator: 0, members: [0] });
console.log("group created", g.id);
inviteToGroup(g.id, 1, 0);
inviteToGroup(g.id, 3, 0);
console.log("invited 1 and 3");
resolveInvite(g.id, 1, true);
resolveInvite(g.id, 3, true);
console.log("1 and 3 accepted");
const tagged = tagMessage(g.id, g.title, GROUPMSG);
await pair(0, 1, 0, tagged);
await pair(0, 3, 0, tagged);
console.log("group fanned out:", tagged);
console.log("SMOKE INJECTED group=" + g.id);
// Fan-out goes only to the sender's own pair threads (Vox requires the
// speaker to be a thread endpoint); members read group lines there.
