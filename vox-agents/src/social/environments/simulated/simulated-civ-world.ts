// The generated world, as the social environment uses it.
//
// The simulation engine already exists and is already tested: seats with gold,
// science, culture, cities, armies and regard, a turn that advances all of it, and
// war on top. This class is the thin layer that holds one of those worlds, renders
// a briefing for one seat, and applies one seat's order to it.
//
// It exists so the adapter next door can be about the social runtime rather than
// about the game. Nothing here knows what a channel or an actor is.

import { makeRandom } from "opencode-harness/world/simulated/engine.js";
import type { SimEvent, SimSeat, SimState } from "opencode-harness/world/simulated/types.js";
import type { WarState } from "opencode-harness/world/simulated/war.js";

// What the harness simulation offers, loaded on first use so nothing depends on
// the built harness until a session actually wants a generated world.
export interface SimulatedCivEngine {
  // Build a world of the given seats from a seed.
  createSimState(options: { seats: string[]; seed: number; game?: string }): SimState;
  // Advance the whole world one turn.
  advanceTurn(state: SimState): void;
  // Apply the actions one seat committed, which the engine validates.
  applyCommit(state: SimState, seat: string, actions: Array<Record<string, unknown>>): string[];
  // The technology this seat may choose from.
  researchOptions(player: SimSeat): string[];
  // The policy this seat may adopt, when one is ready.
  policyOptions(player: SimSeat): string[];
  // Gold this seat makes each turn.
  goldPerTurn(player: SimSeat): number;
  // The civilization and leader a seat is.
  defineCiv(seat: string): { civ: string; leader: string };
  // Geography, armies and war.
  createWarState(state: SimState): WarState;
  neighboursOf(state: SimState, seat: string): string[];
  massTroops(state: SimState, war: WarState, seat: string, target: string | null, committed: number): { taken: boolean; reason?: string };
  declareWar(state: SimState, seat: string, target: string): { taken: boolean; reason?: string };
  makePeace(state: SimState, seat: string, target: string): { taken: boolean; reason?: string };
  resolveAttack(state: SimState, war: WarState, attacker: string, defender: string, roll: number): { detail: string; won: boolean; captured: string | null };
  visibleArmy(state: SimState, war: WarState, observer: string, other: string, fuzz?: number): { massed: boolean; estimate: number; turnsFacing: number };
  massedAgainst(war: WarState, seat: string, target: string): number;
}

// Load the harness simulation once per process.
let loaded: Promise<SimulatedCivEngine> | null = null;
export function loadSimulatedCivEngine(): Promise<SimulatedCivEngine> {
  if (loaded) return loaded;
  loaded = (async (): Promise<SimulatedCivEngine> => {
    const [engine, content, war] = await Promise.all([
      import("opencode-harness/world/simulated/engine.js"),
      import("opencode-harness/world/simulated/content.js"),
      import("opencode-harness/world/simulated/war.js"),
    ]);
    return {
      createSimState: engine.createSimState,
      // The engine's rates are the default set, bound here so this surface is
      // about the game rather than about tuning it.
      advanceTurn: (state: SimState) => engine.advanceTurn(state, engine.defaultSimConfig),
      applyCommit: (state: SimState, seat: string, actions: Array<Record<string, unknown>>) =>
        engine.applyCommit(state, seat, actions as unknown as Parameters<typeof engine.applyCommit>[2]),
      researchOptions: engine.researchOptions,
      policyOptions: engine.policyOptions,
      goldPerTurn: (player: SimSeat) => engine.goldPerTurn(player, engine.defaultSimConfig),
      defineCiv: (seat: string) => {
        const found = content.civBySeat(seat);
        return { civ: found.civ, leader: found.leader };
      },
      createWarState: war.createWarState,
      neighboursOf: war.neighboursOf,
      massTroops: war.massTroops,
      declareWar: war.declareWar,
      makePeace: war.makePeace,
      resolveAttack: war.resolveAttack,
      visibleArmy: war.visibleArmy,
      massedAgainst: war.massedAgainst,
    };
  })();
  return loaded;
}

// What one order did.
export interface WorldOrderResult {
  // Whether the world took it.
  taken: boolean;
  // Why not, when it did not.
  reason?: string;
  // What happened, when something did.
  detail?: string;
}

// One world, held for the length of a social session.
export class SimulatedCivWorld {
  // The game state.
  readonly state: SimState;

  // Where every army is standing.
  readonly war: WarState;

  // The engine this world was built from, kept so the methods read plainly.
  private readonly engine: SimulatedCivEngine;

  // A seeded source for the rolls a battle needs, so a run replays exactly.
  private readonly roll: () => number;

  // Build a world of the given seats from a seed.
  constructor(engine: SimulatedCivEngine, seats: string[], seed: number, game: string) {
    this.engine = engine;
    this.state = engine.createSimState({ seats, seed, game });
    this.war = engine.createWarState(this.state);
    this.roll = makeRandom(seed * 7919 + 13);
  }

  // How the seats are laid out, in table order.
  get seats(): string[] {
    return this.state.order;
  }

  // The civilization name of a seat, for everything a model reads.
  civOf(seat: string): string {
    return this.state.seats[seat]?.civ ?? seat;
  }

  // Advance the whole world one turn, and answer what happened.
  advance(): SimEvent[] {
    const before = this.state.events.length;
    this.engine.advanceTurn(this.state);
    return this.state.events.slice(before);
  }

  // Advance the world and answer everything recorded since a mark.
  //
  // A caller that acts on the world before advancing it needs this rather than
  // advance(), because an order given at the start of a turn writes its own news
  // and that news is the point of the turn.
  advanceFrom(mark: number): SimEvent[] {
    this.engine.advanceTurn(this.state);
    return this.state.events.slice(mark);
  }

  // Everything recorded since a point in the event log, which is how a seat is
  // told what has happened since it last looked.
  eventsSince(fromIndex: number, seat: string): SimEvent[] {
    return this.state.events.slice(fromIndex).filter((event) => event.seat === null || event.seat === seat);
  }

  // How many events have been recorded, which is the mark a reader moves forward.
  get eventCount(): number {
    return this.state.events.length;
  }

  // Carry out one order for one seat.
  //
  // Research, policy and regard go through the engine, which already validates
  // them and already refuses what is not legal. The war verbs go through the war
  // layer, which is where the geography and the armies live.
  apply(seat: string, action: string, args: Record<string, unknown>): WorldOrderResult {
    const player = this.state.seats[seat];
    if (!player) return { taken: false, reason: "no seat named " + seat + " is at this table" };
    switch (action) {
      case "set_research": {
        const technology = typeof args.technology === "string" ? args.technology : "";
        const applied = this.engine.applyCommit(this.state, seat, [{ type: "research", technology, rationale: "ordered through the social environment" }]);
        const refused = applied.find((line) => /refused/i.test(line));
        return refused ? { taken: false, reason: refused } : { taken: true, detail: applied.join("; ") };
      }
      case "set_policy": {
        const policy = typeof args.policy === "string" ? args.policy : "";
        const applied = this.engine.applyCommit(this.state, seat, [{ type: "policy", policy, rationale: "ordered through the social environment" }]);
        const refused = applied.find((line) => /refused/i.test(line));
        return refused ? { taken: false, reason: refused } : { taken: true, detail: applied.join("; ") };
      }
      case "set_posture": {
        const target = typeof args.target === "string" ? args.target : "";
        if (!this.state.seats[target]) return { taken: false, reason: "no seat named " + target };
        const publicValue = typeof args.public === "number" ? args.public : undefined;
        const privateValue = typeof args.private === "number" ? args.private : undefined;
        this.engine.applyCommit(this.state, seat, [{ type: "posture", target: this.state.seats[target].playerID, public: publicValue, private: privateValue, rationale: "recorded through the social environment" }]);
        return { taken: true, detail: this.civOf(seat) + " has recorded how it regards " + this.civOf(target) };
      }
      case "mass_troops": {
        const facing = typeof args.facing === "string" ? args.facing : null;
        const committed = typeof args.committed === "number" ? args.committed : 0;
        const result = this.engine.massTroops(this.state, this.war, seat, facing, committed);
        return result.taken ? { taken: true, detail: this.armyLine(seat) } : { taken: false, reason: result.reason };
      }
      case "declare_war": {
        const target = typeof args.target === "string" ? args.target : "";
        const result = this.engine.declareWar(this.state, seat, target);
        return result.taken ? { taken: true, detail: this.civOf(seat) + " has declared war on " + this.civOf(target) } : { taken: false, reason: result.reason };
      }
      case "make_peace": {
        const target = typeof args.target === "string" ? args.target : "";
        const result = this.engine.makePeace(this.state, seat, target);
        return result.taken ? { taken: true, detail: this.civOf(seat) + " has made peace with " + this.civOf(target) } : { taken: false, reason: result.reason };
      }
      case "attack": {
        const target = typeof args.target === "string" ? args.target : "";
        if (!this.state.seats[target]) return { taken: false, reason: "no seat named " + target };
        if (!this.state.seats[seat].relationships[target]?.atWar) {
          return { taken: false, reason: this.civOf(seat) + " is not at war with " + this.civOf(target) };
        }
        const battle = this.engine.resolveAttack(this.state, this.war, seat, target, this.roll());
        return { taken: true, detail: battle.detail };
      }
      default:
        return { taken: false, reason: "the world has no action called " + action };
    }
  }

  // How a seat's army is placed, in one line.
  armyLine(seat: string): string {
    const held = this.war[seat];
    const civ = this.civOf(seat);
    if (!held || held.facing === null || held.committed === 0) return civ + " has its army at home";
    return civ + " has " + Math.round(held.committed * 100) + "% of its army facing " + this.civOf(held.facing);
  }

  // What one seat can see of another's army.
  seenArmy(observer: string, other: string): { massed: boolean; estimate: number; turnsFacing: number } {
    return this.engine.visibleArmy(this.state, this.war, observer, other, 0);
  }

  // What a seat knows of its own army, which is exact rather than estimated.
  ownArmy(seat: string): number {
    return this.engine.massedAgainst(this.war, seat, this.war[seat]?.facing ?? "");
  }

  // The seats this seat borders.
  neighbours(seat: string): string[] {
    return this.engine.neighboursOf(this.state, seat);
  }

  // Bring every army home and end every war, which is how a run is reset between
  // experiments without rebuilding the world.
  standDown(): void {
    for (const seat of this.state.order) {
      if (this.war[seat].facing !== null) this.engine.massTroops(this.state, this.war, seat, null, 0);
    }
  }

  // What a seat's own position looks like, which is the part of a briefing that
  // comes from the seat rather than from the table.
  ownPosition(seat: string): string[] {
    const player = this.state.seats[seat];
    const research = player.currentResearch ?? "nothing chosen";
    const options = this.engine.researchOptions(player);
    const lines: string[] = [];
    lines.push(
      "Treasury " +
        Math.round(player.gold) +
        " (+" +
        this.engine.goldPerTurn(player) +
        "/turn), " +
        (player.happiness >= 0 ? "your people are content" : "your people are unhappy") +
        ", and your scholars know " +
        player.techs.length +
        " technologies."
    );
    lines.push(
      "You are " +
        player.cities.length +
        " cities with " +
        player.cities.reduce((sum, city) => sum + city.population, 0) +
        " people, " +
        player.units +
        " units at strength " +
        player.militaryStrength +
        ", in the " +
        player.era +
        " era, with a standing of " +
        player.score +
        "."
    );
    lines.push("Your scholars are working on " + research + ". They could turn to: " + options.join(", ") + ".");
    const policies = this.engine.policyOptions(player);
    lines.push(
      player.policyAvailable
        ? "A social policy is ready to adopt: " + policies.join("; ") + "."
        : "No social policy is ready yet."
    );
    lines.push("Your army: " + this.armyLine(seat) + ".");
    return lines;
  }

  // What a seat can see of each of its neighbours, which is the part of a
  // briefing a seat reads to decide whether to start asking questions.
  tableLine(seat: string): string[] {
    const lines: string[] = [];
    for (const other of this.state.order) {
      if (other === seat) continue;
      const rival = this.state.seats[other];
      const seen = this.seenArmy(seat, other);
      const regard = this.state.seats[seat].relationships[other];
      const borders = this.neighbours(seat).includes(other);
      const parts: string[] = [];
      parts.push("standing " + rival.score + ", " + rival.cities.length + " cities, treasury about " + Math.round(rival.gold));
      parts.push(borders ? "they border you" : "they do not border you");
      if (regard?.atWar) parts.push("YOU ARE AT WAR");
      else if (regard && regard.publicValue <= -1) parts.push("they have been cool toward you");
      else if (regard && regard.publicValue >= 1) parts.push("they have been warm toward you");
      // The visible army is the thing a neighbour can see and cannot explain.
      if (seen.massed) {
        parts.push(
          "their army is massed on YOUR border, about " +
            seen.estimate +
            " strong, and has been there " +
            seen.turnsFacing +
            (seen.turnsFacing === 1 ? " turn" : " turns")
        );
      } else if (this.war[other]?.facing && this.war[other].committed > 0) {
        parts.push("part of their army is away from home, facing " + this.civOf(this.war[other].facing ?? other));
      } else {
        parts.push("their army appears to be at home");
      }
      lines.push("- " + rival.civ + ", led by " + rival.leader + ": " + parts.join("; ") + ".");
    }
    return lines;
  }
}
