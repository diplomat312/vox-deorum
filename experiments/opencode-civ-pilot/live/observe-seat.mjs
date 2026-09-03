// Print one seat's shared observation to stdout.
// Same builder the OpenCode harness uses (observe.mjs), so seat 0 (Codex)
// and seat 1 (harness) always see the same dashboard shape.
// Usage: node observe-seat.mjs --player 0 --turn 108 [--game live-duel] [--since M] [--state <file>]
// With --state, also writes a small seat-tracking record (file-only, never
// model-visible) so BOTH seats stay tracked: Siam via run-live-turn.mjs
// (civ-state-siam.json), Portugal via this script (civ-state-portugal.json).
import fs from "node:fs";
import { buildObservation } from "./observe.mjs";

const SEATS = {
  0: { civ: "Portugal", leader: "Maria I", rivalID: 1, rivalCiv: "Siam", rivalLeader: "Ramkhamhaeng" },
  1: { civ: "Siam", leader: "Ramkhamhaeng", rivalID: 0, rivalCiv: "Portugal", rivalLeader: "Maria I" },
};

function arg(name, dflt = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? dflt) : dflt;
}

const playerID = Number(arg("player", NaN));
const turn = Number(arg("turn", NaN));
if (!SEATS[playerID] || !Number.isFinite(turn)) {
  console.error("usage: node observe-seat.mjs --player 0|1 --turn <N>");
  process.exit(2);
}
const s = SEATS[playerID];
const obs = await buildObservation({
  playerID,
  civ: s.civ,
  leader: s.leader,
  seat: playerID,
  rivalID: s.rivalID,
  rivalCiv: s.rivalCiv,
  rivalLeader: s.rivalLeader,
  rivalSeat: s.rivalID,
  turn,
  game: arg("game", "live-duel"),
  lastSeenTurn: Number(arg("since", 0)),
});
console.log(obs);
const statePath = arg("state", null);
if (statePath) {
  const rec = { seat: playerID, civ: s.civ, leader: s.leader, turn, since: Number(arg("since", 0)), observedAt: new Date().toISOString(), obs_chars: obs.length };
  fs.writeFileSync(statePath, JSON.stringify(rec, null, 1) + "\n");
}
