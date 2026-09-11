// Circumstances a run can inject on purpose.
// This is what the environment exists for: a seat's ordinary turn is less
// interesting than its reaction to a military surge on its border, a rival
// breaking its word, or an ally going to war. A scenario states what happens,
// on which turn, to whom, and the world applies it and puts it in the news.

import { civBySeat } from "./content.js";
import { pushEvent, totalPopulation } from "./engine.js";
import type { SimSeat, SimState } from "./types.js";

// One thing that happens to the world on a chosen turn.
export interface ScenarioShock {
  // The turn it happens on.
  turn: number;
  // What kind of shock this is.
  kind:
    | "betrayal"
    | "military-surge"
    | "gold-surge"
    | "tech-leap"
    | "war"
    | "peace"
    | "city-founded"
    | "plague"
    | "bankruptcy";
  // The seat it happens to.
  seat: string;
  // The other seat involved, for betrayals, wars and peaces.
  target?: string;
  // How big the shock is, meaning what the kind of shock measures.
  magnitude?: number;
  // A line for the news, when the default wording is not what is wanted.
  detail?: string;
}

// A whole scenario: the world it starts from plus what happens along the way.
export interface Scenario {
  // A name for the scenario, used in the run record.
  name: string;
  // The seats at the table.
  seats: string[];
  // The seed the world is generated from.
  seed: number;
  // How many turns to play.
  turns: number;
  // The shocks to inject, in any order; they are applied by turn.
  shocks: ScenarioShock[];
}

// Apply every shock due on this turn. Returns the lines that were added to the
// news, so a caller can record what a run did to its seats.
export function applyShocks(state: SimState, shocks: ScenarioShock[]): string[] {
  const applied: string[] = [];
  for (const shock of shocks) {
    if (shock.turn !== state.turn) continue;
    const player = state.seats[shock.seat];
    if (!player) continue;
    applied.push(applyShock(state, player, shock));
  }
  return applied;
}

// Apply one shock and write what it did into the news.
function applyShock(state: SimState, player: SimSeat, shock: ScenarioShock): string {
  const magnitude = shock.magnitude ?? 1;
  if (shock.kind === "betrayal") {
    const target = shock.target ? state.seats[shock.target] : undefined;
    if (target) {
      const relation = player.relationships[target.seat];
      if (relation) {
        relation.privateValue = Math.max(-8, relation.privateValue - 4 * magnitude);
        relation.publicValue = Math.max(-6, relation.publicValue - 2 * magnitude);
      }
      const detail =
        shock.detail ??
        player.civ +
          " broke their word to " +
          target.civ +
          ". Their envoys are no longer welcome in " +
          target.cities[0].name +
          ".";
      pushEvent(state, player.seat, "betrayal", detail);
      pushEvent(state, target.seat, "betrayal", detail);
      return detail;
    }
  }
  if (shock.kind === "military-surge") {
    player.militaryStrength = Math.round(player.militaryStrength * (1 + 0.5 * magnitude));
    player.units += Math.round(3 * magnitude);
    const detail = shock.detail ?? player.civ + " is massing troops near the frontier";
    pushEvent(state, player.seat, "military-surge", detail);
    return detail;
  }
  if (shock.kind === "gold-surge") {
    player.gold += Math.round(200 * magnitude);
    const detail = shock.detail ?? player.civ + " has struck a windfall";
    pushEvent(state, player.seat, "gold-surge", detail);
    return detail;
  }
  if (shock.kind === "tech-leap") {
    const gained = Math.max(1, Math.round(magnitude));
    const before = player.techs.length;
    for (let index = 0; index < gained; index += 1) {
      player.techs.push("Recovered knowledge " + (before + index + 1));
    }
    const detail = shock.detail ?? player.civ + " has made a leap in knowledge";
    pushEvent(state, player.seat, "tech-leap", detail);
    return detail;
  }
  if (shock.kind === "war" || shock.kind === "peace") {
    const target = shock.target ? state.seats[shock.target] : undefined;
    if (target) {
      const atWar = shock.kind === "war";
      const here = player.relationships[target.seat];
      const there = target.relationships[player.seat];
      if (here) here.atWar = atWar;
      if (there) there.atWar = atWar;
      const detail =
        shock.detail ??
        (atWar ? player.civ + " declared war on " + target.civ : player.civ + " made peace with " + target.civ);
      pushEvent(state, player.seat, shock.kind, detail);
      pushEvent(state, target.seat, shock.kind, detail);
      return detail;
    }
  }
  if (shock.kind === "city-founded") {
    const definition = civBySeat(player.seat);
    const name = definition.cityNames[player.cities.length];
    if (name) {
      player.cities.push({
        name,
        population: 1,
        tiles: 7,
        production: "Monument",
        productionTurnsLeft: 6,
        growthProgress: 0,
        growthNeeded: 15
      });
      const detail = shock.detail ?? player.civ + " founded " + name;
      pushEvent(state, player.seat, "city-founded", detail);
      return detail;
    }
  }
  if (shock.kind === "plague") {
    const loss = Math.max(1, Math.round(totalPopulation(player) * 0.2 * magnitude));
    for (const city of player.cities) {
      city.population = Math.max(1, city.population - Math.ceil(loss / player.cities.length));
    }
    const detail = shock.detail ?? "Famine and disease have emptied " + player.civ + "'s granaries";
    pushEvent(state, player.seat, "plague", detail);
    return detail;
  }
  if (shock.kind === "bankruptcy") {
    // Empty a treasury on purpose. This exists to make a promise that was
    // genuinely made go unpaid, so the broken word a seat reacts to is real
    // rather than narrated: the tribute simply cannot be paid.
    const emptied = player.gold;
    player.gold = 0;
    const detail = shock.detail ?? player.civ + "'s treasury is empty and its promised payments cannot be met";
    pushEvent(state, player.seat, "bankruptcy", detail);
    return detail + " (drained " + emptied + " gold)";
  }
  return "An unknown shock of kind '" + shock.kind + "' was ignored";
}
