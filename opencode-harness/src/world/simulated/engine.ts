// The rules a simulated game advances by.
// Everything here is deterministic: the same seed, the same seats and the same
// choices always produce the same game. That is what makes two runs comparable
// when the only thing that changed was how a seat was prompted or informed.

import {
  availablePolicies,
  availableTechs,
  buildOptions,
  civBySeat,
  eraForTechCount,
  type CivDefinition
} from "./content.js";
import type { SimCity, SimConfig, SimSeat, SimState, SimTransfer } from "./types.js";

// The rates a simulated game runs at when nothing is calibrated. They are set
// to the shape of an ordinary early game: a handful of cities by turn 60, a
// technology every several turns, a policy every couple of dozen turns.
export const defaultSimConfig: SimConfig = {
  startGold: 0,
  startGoldPerTurn: 5,
  goldPerTurnPerCity: 3,
  startSciencePerTurn: 6,
  sciencePerTurnPerPopulation: 0.6,
  startCulturePerTurn: 1,
  culturePerTurnPerCity: 0.6,
  startFaithPerTurn: 0,
  firstTechCost: 25,
  techCostGrowth: 1.16,
  // The first policy must arrive inside a normal run, because a mechanic that
  // cannot be used is not being tested. At fifty it arrived on turn forty-three,
  // which is past the end of every run played, so every policy action ever
  // committed was silently refused and the social policy tree went unexercised.
  firstPolicyCost: 12,
  policyCostGrowth: 1.22,
  firstGrowthNeeded: 15,
  growthNeededPerPopulation: 6,
  growthPerTurn: 5,
  startMilitaryStrength: 14,
  militaryPerTurn: 0.35,
  startUnits: 2,
  startScore: 30,
  scorePerTurn: 0.35,
  scorePerTech: 6,
  scorePerCity: 8,
  scorePerPolicy: 10,
  turnsBetweenCities: 28,
  maxCities: 5
};

// A seeded random source, so a game is reproducible but not rigid.
export function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// Round to one decimal place, so the numbers a seat reads stay legible.
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

// Build a fresh game.
export function createSimState(options: {
  seats: string[];
  seed: number;
  config?: SimConfig;
  game?: string;
  startTurn?: number;
}): SimState {
  const config = options.config ?? defaultSimConfig;
  const seats: Record<string, SimSeat> = {};
  const order: string[] = [];
  options.seats.forEach((seat, index) => {
    const definition: CivDefinition = civBySeat(seat);
    const relationships: SimSeat["relationships"] = {};
    for (const other of options.seats) {
      if (other === seat) continue;
      relationships[other] = { publicValue: 0, privateValue: 0, atWar: false, metOnTurn: 0 };
    }
    seats[seat] = {
      seat,
      playerID: index,
      civ: definition.civ,
      leader: definition.leader,
      cities: [newCity(definition.cityNames[0], config)],
      gold: config.startGold,
      happiness: 5,
      sciencePerTurn: config.startSciencePerTurn,
      culturePerTurn: config.startCulturePerTurn,
      faithPerTurn: config.startFaithPerTurn,
      goldPerTurn: config.startGoldPerTurn,
      techs: [],
      currentResearch: null,
      researchProgress: 0,
      policies: [],
      policyProgress: 0,
      policyAvailable: false,
      era: "Ancient",
      units: config.startUnits,
      militaryStrength: config.startMilitaryStrength,
      militarySupply: config.startMilitaryStrength,
      score: config.startScore,
      relationships,
      grandStrategy: null,
      economicStrategies: [],
      militaryStrategies: [],
      lastTurnActed: 0,
      lastApplied: []
    };
    order.push(seat);
  });
  const state: SimState = {
    game: options.game ?? "sim",
    turn: options.startTurn ?? 1,
    seed: options.seed,
    order,
    seats,
    events: [],
    settledDeals: [],
    transfers: []
  };
  for (const seat of order) {
    pushEvent(state, seat, "table", seat + " enters the game");
  }
  return state;
}

// Make one city at the given population.
function newCity(name: string, config: SimConfig): SimCity {
  return {
    name,
    population: 1,
    tiles: 7,
    production: buildOptions[0].name,
    productionTurnsLeft: Math.ceil(buildOptions[0].cost / 4),
    growthProgress: 0,
    growthNeeded: config.firstGrowthNeeded
  };
}

// Add an event to the world's news.
export function pushEvent(state: SimState, seat: string | null, kind: string, detail: string): void {
  state.events.push({ turn: state.turn, seat, kind, detail });
  if (state.events.length > 4000) state.events.splice(0, state.events.length - 4000);
}

// The science a seat produces this turn, from its population and its cities.
export function sciencePerTurn(seat: SimSeat, config: SimConfig): number {
  const population = totalPopulation(seat);
  return round1(config.startSciencePerTurn * 0.4 + population * config.sciencePerTurnPerPopulation + seat.cities.length * 1.2);
}

// The gold a seat produces this turn.
export function goldPerTurn(seat: SimSeat, config: SimConfig): number {
  return round1(config.startGoldPerTurn + (seat.cities.length - 1) * config.goldPerTurnPerCity);
}

// The culture a seat produces this turn.
export function culturePerTurn(seat: SimSeat, config: SimConfig): number {
  return round1(config.startCulturePerTurn + (seat.cities.length - 1) * config.culturePerTurnPerCity);
}

// The population of a seat across its cities.
export function totalPopulation(seat: SimSeat): number {
  return seat.cities.reduce((sum, city) => sum + city.population, 0);
}

// The tiles a seat works across its cities.
export function totalTerritory(seat: SimSeat): number {
  return seat.cities.reduce((sum, city) => sum + city.tiles, 0);
}

// What the next technology costs, given how many are already known.
export function techCost(techCount: number, config: SimConfig): number {
  return Math.round(config.firstTechCost * Math.pow(config.techCostGrowth, techCount));
}

// What the next policy costs, given how many are already adopted.
export function policyCost(policyCount: number, config: SimConfig): number {
  return Math.round(config.firstPolicyCost * Math.pow(config.policyCostGrowth, Math.max(0, policyCount - 1)));
}

// Advance the world by one turn. Growth, science, culture, production and the
// occasional new city all come from here.
export function advanceTurn(state: SimState, config: SimConfig): void {
  state.turn += 1;
  for (const seat of state.order) {
    const player = state.seats[seat];
    growCities(state, player, config);
    advanceProduction(state, player);
    advanceResearch(state, player, config);
    advancePolicy(state, player, config);
    player.gold = round1(player.gold + goldPerTurn(player, config));
    payTribute(state, player);
    player.sciencePerTurn = sciencePerTurn(player, config);
    player.culturePerTurn = culturePerTurn(player, config);
    player.militaryStrength = round1(player.militaryStrength + config.militaryPerTurn);
    player.units = config.startUnits + Math.floor((player.militaryStrength - config.startMilitaryStrength) / 12);
    player.score =
      config.startScore +
      Math.round(
        config.scorePerTurn * state.turn +
          config.scorePerTech * player.techs.length +
          config.scorePerCity * (player.cities.length - 1) +
          config.scorePerPolicy * player.policies.length
      );
    player.era = eraForTechCount(player.techs.length);
    considerFounding(state, player, config);
  }
}

// Move whatever tribute this seat is paying or receiving, and retire a tribute
// once its turns run out or the payer cannot pay. A bankrupt seat pays what it
// can, and the promise ends rather than going into debt.
function payTribute(state: SimState, player: SimSeat): void {
  const finished: SimTransfer[] = [];
  for (const transfer of state.transfers) {
    if (transfer.from !== player.seat && transfer.to !== player.seat) continue;
    const payer = state.seats[transfer.from];
    const receiver = state.seats[transfer.to];
    if (!payer || !receiver) {
      finished.push(transfer);
      continue;
    }
    const paid = Math.min(transfer.goldPerTurn, Math.max(0, payer.gold));
    payer.gold = Math.round((payer.gold - paid) * 10) / 10;
    receiver.gold = Math.round((receiver.gold + paid) * 10) / 10;
    transfer.remaining -= 1;
    if (transfer.remaining <= 0 || paid < transfer.goldPerTurn) {
      const missed = paid < transfer.goldPerTurn;
      pushEvent(
        state,
        payer.seat,
        "deal",
        "Tribute from " + payer.civ + " to " + receiver.civ + " has ended after " + (missed ? "a missed payment" : "its agreed term")
      );
      // A promise that was not kept costs standing with the seat that was owed.
      //
      // Only that seat knows, so its private regard drops and its public
      // regard does not: the table has not been told. This is what lets a
      // reputation form from conduct rather than only from what a seat says
      // about itself.
      if (missed) {
        const regard = receiver.relationships[payer.seat];
        if (regard) regard.privateValue = Math.max(-8, regard.privateValue - 3);
        pushEvent(
          state,
          receiver.seat,
          "deal",
          receiver.civ + " was not paid what " + payer.civ + " promised"
        );
      }
      finished.push(transfer);
    }
  }
  if (finished.length > 0) state.transfers = state.transfers.filter((entry) => !finished.includes(entry));
}

// Grow each city and settle whether a second one can be founded.
function growCities(state: SimState, player: SimSeat, config: SimConfig): void {
  for (const city of player.cities) {
    city.growthProgress = round1(city.growthProgress + config.growthPerTurn);
    if (city.growthProgress >= city.growthNeeded) {
      city.growthProgress = 0;
      city.population += 1;
      city.tiles += 3;
      city.growthNeeded = Math.round(config.firstGrowthNeeded + city.population * config.growthNeededPerPopulation);
      pushEvent(state, player.seat, "growth", city.name + " grew to population " + city.population);
    }
  }
}

// Move a city's build along, and announce it when it finishes.
function advanceProduction(state: SimState, player: SimSeat): void {
  for (const city of player.cities) {
    if (city.productionTurnsLeft === null) continue;
    city.productionTurnsLeft -= 1;
    if (city.productionTurnsLeft <= 0) {
      pushEvent(state, player.seat, "production", city.name + " finished " + String(city.production));
      // The next build is chosen from the city's own position on the list, so
      // the same seeded game always produces the same production sequence.
      const next = buildOptions[(city.population + state.turn + city.name.length) % buildOptions.length];
      city.production = next.name;
      city.productionTurnsLeft = Math.max(3, Math.ceil(next.cost / (2 + city.population)));
    }
  }
}

// Turn science into technologies.
function advanceResearch(state: SimState, player: SimSeat, config: SimConfig): void {
  if (!player.currentResearch) return;
  player.researchProgress = round1(player.researchProgress + player.sciencePerTurn);
  const cost = techCost(player.techs.length, config);
  if (player.researchProgress >= cost) {
    // A technology is only ever learned once. Guarding here as well as at the
    // commit keeps a long game from accumulating duplicates.
    if (!player.techs.includes(player.currentResearch)) {
      player.techs.push(player.currentResearch);
      pushEvent(state, player.seat, "tech", "Research of " + player.currentResearch + " completed");
    }
    player.currentResearch = null;
    player.researchProgress = 0;
  }
}

// Turn culture into policies.
function advancePolicy(state: SimState, player: SimSeat, config: SimConfig): void {
  player.policyProgress = round1(player.policyProgress + player.culturePerTurn);
  const cost = policyCost(player.policies.length, config);
  if (player.policyProgress >= cost && !player.policyAvailable) {
    player.policyProgress = 0;
    player.policyAvailable = true;
    pushEvent(state, player.seat, "policy", "A social policy is ready to be adopted");
  }
}

// Found a new city when enough turns have passed since the last one.
function considerFounding(state: SimState, player: SimSeat, config: SimConfig): void {
  if (player.cities.length >= config.maxCities) return;
  const definition = civBySeat(player.seat);
  const name = definition.cityNames[player.cities.length];
  if (!name) return;
  const foundedTurn = state.turn - (player.cities.length - 1) * config.turnsBetweenCities;
  if (foundedTurn < config.turnsBetweenCities) return;
  player.cities.push(newCity(name, config));
  pushEvent(state, player.seat, "city-founded", player.civ + " founded " + name);
}

// What a seat asked the world to do this turn.
export interface SimCommitAction {
  // Which kind of action this is.
  type: string;
  // The technology to research, when this is a research action.
  technology?: string;
  // The policy to adopt, when this is a policy action.
  policy?: string;
  // The seat to aim a posture at, when this is a posture action.
  target?: number;
  // The public relationship value, when this is a posture action.
  public?: number;
  // The private relationship value, when this is a posture action.
  private?: number;
  // The grand strategy, when this is a strategy action.
  grand?: string;
  // The economic strategies, when this is a strategy action.
  economic?: string[];
  // The military strategies, when this is a strategy action.
  military?: string[];
}

// Carry out a seat's committed actions and report what happened to each one.
export function applyCommit(state: SimState, seat: string, actions: SimCommitAction[]): string[] {
  const player = state.seats[seat];
  const applied: string[] = [];
  if (!player) return applied;
  for (const action of actions) {
    if (action.type === "research" && action.technology) {
      if (player.techs.includes(action.technology)) {
        applied.push("Research refused: " + action.technology + " is already known");
      } else {
        player.currentResearch = action.technology;
        player.researchProgress = 0;
        applied.push("Research set to " + action.technology);
      }
    } else if (action.type === "policy" && action.policy) {
      if (player.policyAvailable) {
        player.policies.push(action.policy);
        player.policyAvailable = false;
        applied.push("Adopted " + action.policy);
        pushEvent(state, seat, "policy", player.civ + " adopted " + action.policy);
      } else {
        applied.push("Policy refused: none was ready");
      }
    } else if (action.type === "posture") {
      const target = targetSeat(state, seat, action.target);
      if (target) {
        const relation = player.relationships[target];
        if (typeof action.public === "number") relation.publicValue = action.public;
        if (typeof action.private === "number") relation.privateValue = action.private;
        applied.push("Posture toward " + state.seats[target].civ + " recorded");
      } else {
        applied.push("Posture refused: that seat is not at the table");
      }
    } else if (action.type === "strategy") {
      if (action.grand) player.grandStrategy = action.grand;
      if (Array.isArray(action.economic)) player.economicStrategies = action.economic;
      if (Array.isArray(action.military)) player.militaryStrategies = action.military;
      applied.push("Strategy recorded");
    } else if (action.type === "keep_status_quo") {
      applied.push("Kept the status quo");
    } else {
      applied.push("Ignored an action of type " + action.type);
    }
  }
  player.lastApplied = applied;
  player.lastTurnActed = state.turn;
  return applied;
}

// Resolve a seat written as a player index into a seat name.
function targetSeat(state: SimState, seat: string, playerID: number | undefined): string | null {
  if (typeof playerID !== "number") return null;
  const target = state.order.find((name) => state.seats[name].playerID === playerID);
  if (target && state.seats[seat].relationships[target]) return target;
  return null;
}

// The technologies a seat may research next.
export function researchOptions(player: SimSeat): string[] {
  return availableTechs(player.techs, 5);
}

// Write the world out as plain JSON, so a separate process can read the state
// a run has reached. The tool server runs in its own process, so a snapshot on
// disk is what lets it answer inspect from the live game rather than a guess.
export function serializeSimState(state: SimState): string {
  return JSON.stringify(state);
}

// Read a world back from a snapshot. A snapshot that does not carry the fields
// a world needs stops the caller, because answering from half a world would be
// worse than not answering at all.
export function deserializeSimState(text: string): SimState {
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("A world snapshot must be a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.game !== "string" || typeof record.turn !== "number") {
    throw new Error("A world snapshot must carry a game label and a turn number");
  }
  if (!Array.isArray(record.order) || typeof record.seats !== "object" || record.seats === null) {
    throw new Error("A world snapshot must carry the seat order and the seats themselves");
  }
  return parsed as SimState;
}

// The policies a seat may adopt next.
export function policyOptions(player: SimSeat): string[] {
  return availablePolicies(player.policies, 6);
}
