// War, geography and what one seat can see of another.
//
// The generated world had no map and no way to hurt anyone. A seat could research,
// adopt policies and record how it regarded its neighbours, and then nothing ever
// happened, which is why every simulated run produced the same shape: seats
// suspecting each other, going quiet, and never acting on it.
//
// This adds the smallest geography and war that make a threat mean something. Each
// seat borders two others in a ring, which is the layout the recorded four-seat
// game had. An army sits at home or is massed against a neighbour. Massing is
// visible to the neighbour, because armies are visible, and the intent behind it
// is not, because intent is not. A war is declared, battles are fought on the
// numbers both sides can see, and a losing defence can cost a city.
//
// Nothing here decides anything. A seat masses, declares and attacks, and the
// numbers decide the rest, which is what makes the visible part worth watching.

import type { SimState } from "./types.js";
import { pushEvent } from "./engine.js";

// How one seat's army is placed.
export interface Deployment {
  // The seat this army is massed against, or null when it is at home.
  facing: string | null;
  // How much of the army is with it, from nothing to all of it.
  committed: number;
  // How many turns the army has been in this position, which is what makes a
  // build-up look like a build-up rather than a march.
  turnsFacing: number;
}

// What every seat's army is doing, keyed by seat name.
export type WarState = Record<string, Deployment>;

// A battle that has been fought, kept so a report can read the war back.
export interface BattleRecord {
  // The turn it happened on.
  turn: number;
  // Who attacked.
  attacker: string;
  // Who defended.
  defender: string;
  // What each side fielded, which is what a seat could see of the other.
  attackerStrength: number;
  // What the defender had in place.
  defenderStrength: number;
  // Whether the attack took ground.
  won: boolean;
  // The city that changed hands, when one did.
  captured: string | null;
  // The line both sides read, written in the game's voice.
  detail: string;
}

// The result of an order a seat gave.
export interface WarOrderResult {
  // Whether the order was given.
  taken: boolean;
  // Why not, when it was not.
  reason?: string;
}

// An empty war state for a world, with every army at home.
export function createWarState(state: SimState): WarState {
  const war: WarState = {};
  for (const seat of state.order) war[seat] = { facing: null, committed: 0, turnsFacing: 0 };
  return war;
}

// The seats each seat borders, in a ring in table order.
//
// A ring is not a map, and it is enough: every seat has two neighbours to watch,
// no seat is adjacent to everyone, and who is next to whom is a fact the table
// can be told without anybody having to draw anything.
export function neighboursOf(state: SimState, seat: string): string[] {
  const order = state.order;
  const at = order.indexOf(seat);
  if (at < 0 || order.length < 2) return [];
  if (order.length === 2) return [order[(at + 1) % 2]];
  const before = order[(at - 1 + order.length) % order.length];
  const after = order[(at + 1) % order.length];
  return before === after ? [before] : [before, after];
}

// Whether two seats share a border.
export function areNeighbours(state: SimState, left: string, right: string): boolean {
  return neighboursOf(state, left).includes(right);
}

// How much of a seat's army is standing where another seat can see it.
//
// A full-strength army at home is not a threat to anyone in particular. The same
// army massed on a neighbour's border, and staying there, is the thing the
// neighbour notices.
export function massedAgainst(war: WarState, seat: string, target: string): number {
  const held = war[seat];
  if (!held || held.facing !== target) return 0;
  return held.committed;
}

// What one seat can see of another's army, as numbers a briefing can carry.
export interface SeenArmy {
  // Whether enough of the army is here to be worth noticing.
  massed: boolean;
  // What the observer reckons the army in front of it is worth.
  estimate: number;
  // How long it has been there.
  turnsFacing: number;
}

// What one seat can see of another's army.
//
// The number a seat sees is an estimate rather than the truth, so a neighbour can
// be stronger than it looks and the table has something worth asking about.
export function visibleArmy(state: SimState, war: WarState, observer: string, other: string, fuzz = 0): SeenArmy {
  const player = state.seats[other];
  const deployment = war[other];
  const committed = massedAgainst(war, other, observer);
  const shown = player.militaryStrength * (1 + fuzz);
  return { massed: committed > 0.25, estimate: Math.round(shown * committed), turnsFacing: deployment?.turnsFacing ?? 0 };
}

// Move a seat's army to face one of its neighbours, or bring it home.
//
// A change of target is a new build-up, so the count starts again. Staying where
// you are is what makes a build-up visible as one.
export function massTroops(
  state: SimState,
  war: WarState,
  seat: string,
  target: string | null,
  committed: number
): WarOrderResult {
  const player = state.seats[seat];
  if (!player) return { taken: false, reason: "no seat named " + seat + " is at this table" };
  if (target !== null && !areNeighbours(state, seat, target)) {
    return { taken: false, reason: player.civ + " does not border " + (state.seats[target]?.civ ?? target) };
  }
  if (!(committed >= 0 && committed <= 1)) {
    return { taken: false, reason: "commitment must be between none and all of the army" };
  }
  const held = war[seat] ?? { facing: null, committed: 0, turnsFacing: 0 };
  const continuing = held.facing === target && committed > 0;
  war[seat] = { facing: target, committed, turnsFacing: continuing ? held.turnsFacing + 1 : 1 };
  if (target === null || committed === 0) {
    pushEvent(state, seat, "army", player.civ + " has brought its army home");
    return { taken: true };
  }
  const other = state.seats[target];
  const share = Math.round(committed * 100);
  // The seat learns its own army moved. The neighbour learns an army is there.
  pushEvent(state, seat, "army", player.civ + " has moved " + share + "% of its army to the border with " + (other?.civ ?? target));
  if (other) {
    pushEvent(state, target, "army-nearby", player.civ + " is massing " + share + "% of its army on the border with " + other.civ);
  }
  return { taken: true };
}

// Declare war, which is what turns a build-up into an attack.
export function declareWar(state: SimState, seat: string, target: string): WarOrderResult {
  const player = state.seats[seat];
  const other = state.seats[target];
  if (!player || !other) return { taken: false, reason: "both seats must be at this table" };
  if (!areNeighbours(state, seat, target)) {
    return { taken: false, reason: player.civ + " does not border " + other.civ };
  }
  const here = player.relationships[target];
  const there = other.relationships[seat];
  if (here?.atWar) return { taken: false, reason: player.civ + " is already at war with " + other.civ };
  if (here) here.atWar = true;
  if (there) there.atWar = true;
  // A declaration is public: the whole table hears it, and regard for the
  // aggressor drops with everyone who hears.
  for (const name of state.order) {
    if (name === seat) continue;
    const regard = state.seats[name].relationships[seat];
    if (regard) regard.publicValue = Math.max(-6, regard.publicValue - 2);
  }
  pushEvent(state, seat, "war", player.civ + " has declared war on " + other.civ);
  pushEvent(state, target, "war", player.civ + " has declared war on " + other.civ);
  return { taken: true };
}

// End a war, whether by agreement or exhaustion.
export function makePeace(state: SimState, seat: string, target: string): WarOrderResult {
  const player = state.seats[seat];
  const other = state.seats[target];
  if (!player || !other) return { taken: false, reason: "both seats must be at this table" };
  const here = player.relationships[target];
  const there = other.relationships[seat];
  if (!here?.atWar) return { taken: false, reason: player.civ + " is not at war with " + other.civ };
  if (here) here.atWar = false;
  if (there) there.atWar = false;
  pushEvent(state, seat, "peace", player.civ + " has made peace with " + other.civ);
  pushEvent(state, target, "peace", player.civ + " has made peace with " + other.civ);
  return { taken: true };
}

// Fight one attack, given what each side has and how much of it is here.
//
// Both sides fight with what is in front of them, so a seat that masses its whole
// army and attacks a neighbour massing none of it wins, and two full armies maul
// each other. The roll is seeded, so a run replays exactly and two runs of the
// same seed can be compared.
export function resolveAttack(
  state: SimState,
  war: WarState,
  attacker: string,
  defender: string,
  roll: number
): BattleRecord {
  const theirs = state.seats[attacker];
  const ours = state.seats[defender];
  const empty: BattleRecord = {
    turn: state.turn,
    attacker,
    defender,
    attackerStrength: 0,
    defenderStrength: 0,
    won: false,
    captured: null,
    detail: "no such battle"
  };
  if (!theirs || !ours) return empty;
  const striking = massedAgainst(war, attacker, defender);
  const holding = massedAgainst(war, defender, attacker);
  const attackStrength = round1(theirs.militaryStrength * striking);
  // A defender caught at home still fights, but only partly, which is what makes
  // watching a neighbour's army worth the trouble.
  const defenceStrength = round1(ours.militaryStrength * Math.max(0.35, holding));
  const won = attackStrength + roll * 6 > defenceStrength;
  // Both sides pay for the fight either way.
  theirs.militaryStrength = round1(Math.max(4, theirs.militaryStrength - attackStrength * 0.25));
  ours.militaryStrength = round1(Math.max(4, ours.militaryStrength - attackStrength * (won ? 0.4 : 0.2)));
  let captured: string | null = null;
  if (won && ours.cities.length > 1) {
    // A beaten defence loses its newest city rather than its capital, so a war
    // has consequences a seat can see without the game ending.
    const lost = ours.cities[ours.cities.length - 1];
    ours.cities = ours.cities.slice(0, -1);
    theirs.cities = [...theirs.cities, lost];
    captured = lost.name;
  }
  theirs.units = Math.max(1, Math.round(theirs.militaryStrength / 12));
  ours.units = Math.max(1, Math.round(ours.militaryStrength / 12));
  // The defender is the one who pays in regard, and the one who remembers.
  const regard = ours.relationships[attacker];
  if (regard) regard.privateValue = Math.max(-8, regard.privateValue - 4);
  const detail = won
    ? theirs.civ + " took " + (captured ?? "ground") + " from " + ours.civ
    : ours.civ + " held against " + theirs.civ;
  pushEvent(state, attacker, "battle", detail);
  pushEvent(state, defender, "battle", detail);
  // The whole table hears how the war is going for someone.
  for (const name of state.order) {
    if (name === attacker || name === defender) continue;
    pushEvent(state, name, "battle-heard", detail);
  }
  return {
    turn: state.turn,
    attacker,
    defender,
    attackerStrength: attackStrength,
    defenderStrength: defenceStrength,
    won,
    captured,
    detail
  };
}

// Round a number to one decimal place, the way the engine does.
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
