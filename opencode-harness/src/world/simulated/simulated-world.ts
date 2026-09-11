// A World that generates its own game instead of replaying one.
//
// The material world is ours, which is what makes the diplomacy causal: a seat
// only ever reads a situation that its own choices, and the other seats'
// choices, actually produced. The observation is rendered in the same shape the
// live game produces, so a seat sees the same kind of briefing either way.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DiplomacyGroup, DiplomacyMessage, DiplomacyView } from "../../social/diplomacy-view.js";
import { socialDiplomacyView } from "../../social/diplomacy-view.js";
import type { InspectAnswer, SeatInfo, World } from "../types.js";
import { availablePolicies, availableTechs, buildOptions, eraForTechCount } from "./content.js";
import {
  advanceTurn,
  applyCommit,
  culturePerTurn,
  defaultSimConfig,
  goldPerTurn,
  policyCost,
  researchOptions,
  sciencePerTurn,
  techCost,
  totalPopulation,
  totalTerritory,
  deserializeSimState,
  serializeSimState,
  type SimCommitAction
} from "./engine.js";
import { applyShocks, type ScenarioShock } from "./scenario.js";
import type { SimConfig, SimEvent, SimSeat, SimState } from "./types.js";

// Everything a simulated world needs.
export interface SimulatedWorldOptions {
  // The world state, built by createSimState and advanced by this class.
  state: SimState;
  // Directory holding this run's social log.
  socialDirectory: string;
  // The rates the world advances at.
  config?: SimConfig;
  // Circumstances to inject on chosen turns.
  shocks?: ScenarioShock[];
}

// How a seat regards another, trimmed to what a seat is allowed to know.
function relationshipLine(state: SimState, seat: string, other: string): string {
  const relation = state.seats[seat].relationships[other];
  if (!relation) return "no contact";
  if (relation.atWar) return "AT WAR";
  if (relation.publicValue >= 3) return "Friendly";
  if (relation.publicValue >= 1) return "Cordial";
  if (relation.publicValue <= -3) return "Hostile";
  if (relation.publicValue <= -1) return "Guarded";
  return "Neutral";
}

// The newest events a seat should hear about, oldest first.
function recentEvents(state: SimState, seat: string, sinceTurn: number): SimEvent[] {
  return state.events.filter(
    (event) => event.turn > sinceTurn && (event.seat === null || event.seat === seat)
  );
}

// A short description of a city's build.
function productionLine(city: SimSeat["cities"][number]): string {
  const turns = city.productionTurnsLeft === null ? "soon" : city.productionTurnsLeft + "t left";
  return "- " + city.name + " p" + city.population + " -> " + String(city.production) + " (" + turns + ")";
}

// Renders and advances a generated game.
export class SimulatedWorld implements World {
  // The game label.
  readonly game: string;

  // The world state.
  readonly state: SimState;

  // The rates the world advances at.
  private readonly config: SimConfig;

  // Circumstances to inject on chosen turns.
  private readonly shocks: ScenarioShock[];

  // The diplomacy view over the run's social log.
  private readonly diplomacy: DiplomacyView;

  // Messages delivered to each seat for the turn it is about to play.
  private readonly delivered = new Map<string, DiplomacyMessage[]>();

  // Groups visible to each seat for the turn it is about to play.
  private readonly groups = new Map<string, DiplomacyGroup[]>();

  // Build a world over the given state.
  constructor(options: SimulatedWorldOptions) {
    this.state = options.state;
    this.game = options.state.game;
    this.config = options.config ?? defaultSimConfig;
    this.shocks = options.shocks ?? [];
    this.diplomacy = socialDiplomacyView(options.socialDirectory);
  }

  // Build a read-only view of a world that another process has already
  // advanced. The tool server uses this, because the game itself lives in the
  // harness process and only its snapshot crosses the boundary.
  static async fromSnapshot(stateFile: string, socialDirectory: string): Promise<SimulatedWorld> {
    const { readFile } = await import("node:fs/promises");
    const text = await readFile(stateFile, "utf8");
    return new SimulatedWorld({ state: deserializeSimState(text), socialDirectory });
  }

  // Carry out what a seat committed, so its choices land in the world the other
  // seats will read next turn.
  applyDecision(seat: string, actions: Array<Record<string, unknown>>): void {
    applyCommit(this.state, seat, actions as unknown as SimCommitAction[]);
  }

  // Write the world out so a tool server in another process can read it.
  async writeSnapshot(file: string): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, serializeSimState(this.state), "utf8");
  }

  // The seats at the table.
  seats(): SeatInfo[] {
    return this.state.order.map((seat) => ({
      seat,
      playerID: this.state.seats[seat].playerID,
      session: null
    }));
  }

  // A generated game always has a turn to play until the scenario ends, so this
  // answers yes for any seat at the table.
  hasTurn(seat: string): boolean {
    return seat in this.state.seats;
  }

  // Advance the world to the turn about to be played, inject anything due, then
  // collect what arrived for this seat. Delivery happens here rather than at
  // render time so that rendering stays a plain read.
  async beginTurn(seat: string, turn: number): Promise<void> {
    while (this.state.turn < turn) {
      advanceTurn(this.state, this.config);
      applyShocks(this.state, this.shocks);
    }
    this.delivered.set(seat, await this.diplomacy.deliverMessages(seat));
    this.groups.set(seat, await this.diplomacy.groupsFor(seat));
  }

  // Render the observation for a seat, in the same shape the live game uses.
  observation(seat: string, turn: number): string {
    const player = this.state.seats[seat];
    if (!player) throw new Error("No seat named '" + seat + "' is at this table");
    const others = this.state.order.filter((name) => name !== seat);
    const rivals = others.map((name) => this.state.seats[name]);
    const lines: string[] = [];

    lines.push("TURN " + turn + " (simulated game " + this.game + ")");
    lines.push("");
    lines.push(
      "You are " +
        player.leader +
        ", leader of " +
        player.civ +
        " (seat " +
        player.playerID +
        "). " +
        rivals
          .map((rival) => rival.civ + " (" + rival.leader + ", seat " + rival.playerID + ")")
          .join(", ") +
        (rivals.length === 1 ? " is played by another mind." : " are played by other minds.")
    );
    lines.push("");
    lines.push("Current:");
    lines.push(this.currentLine(player));
    lines.push(this.citiesLine(player));
    for (const city of player.cities) lines.push(productionLine(city));
    lines.push("* Zones:");
    lines.push(
      "- Land: " +
        (player.militaryStrategies[0] ?? "Patrol") +
        " — " +
        player.civ +
        " " +
        player.units +
        " units (strength " +
        player.militaryStrength +
        ")"
    );
    lines.push("* Relationships: " + others.map((name) => this.state.seats[name].civ + " " + relationshipLine(this.state, seat, name)).join("; "));
    for (const rival of rivals) lines.push(this.rivalLine(seat, rival));
    lines.push("");
    lines.push("Since your previous opportunity to act:");
    const events = recentEvents(this.state, seat, player.lastTurnActed);
    if (events.length === 0) lines.push("- Nothing new recorded.");
    for (const event of events.slice(-12)) lines.push("- [turn " + event.turn + "] " + event.detail);
    lines.push("");
    lines.push("What happened to your last committed actions:");
    if (player.lastApplied.length === 0) lines.push("- Nothing committed yet.");
    for (const applied of player.lastApplied) lines.push("- " + applied);
    lines.push("");
    lines.push("Politics since your last opportunity (war/peace, city-states, deals):");
    const political = events.filter((event) => ["war", "peace", "betrayal"].includes(event.kind));
    if (political.length === 0) lines.push("- Nothing new recorded.");
    for (const event of political) lines.push("- [turn " + event.turn + "] " + event.detail);
    lines.push("");
    lines.push(this.messagesSection(seat));
    lines.push("");
    lines.push(this.groupsSection(seat));
    lines.push("");
    lines.push("Deal thread (deal_propose sends; deal_accept {proposalId} enacts; deal_reject {proposalId} declines; inspect(deals) shows what is tradable):");
    lines.push("- No deals on the table.");
    lines.push("");
    lines.push(
      "You may inspect anything else you need (inspect). When finished, commit your actions (commit_turn) or pass. Keep the rationale short."
    );
    return lines.join("\n");
  }

  // Answer an inspect from the generated state.
  async inspect(seat: string, _turn: number, subject: string, detail?: string): Promise<InspectAnswer> {
    const player = this.state.seats[seat];
    if (!player) return { text: "No seat named '" + seat + "' is at this table", gap: true };
    if (subject === "self") return { text: this.selfDetail(player) };
    if (subject === "research") return { text: this.researchDetail(player, detail) };
    if (subject === "cities") return { text: this.citiesDetail(player) };
    if (subject === "economy") {
      return {
        text: JSON.stringify(
          {
            Gold: player.gold,
            GoldPerTurn: goldPerTurn(player, this.config),
            Happiness: player.happiness,
            SciencePerTurn: sciencePerTurn(player, this.config),
            CulturePerTurn: culturePerTurn(player, this.config)
          },
          null,
          1
        )
      };
    }
    if (subject === "military") {
      return {
        text: JSON.stringify(
          {
            Units: player.units,
            MilitaryStrength: player.militaryStrength,
            MilitarySupply: player.militarySupply,
            Strategies: player.militaryStrategies
          },
          null,
          1
        )
      };
    }
    if (subject === "victory") {
      return { text: JSON.stringify({ Score: player.score, Era: player.era, Techs: player.techs.length }, null, 1) };
    }
    if (subject === "diplomacy") {
      return { text: this.diplomacyDetail(seat, detail) };
    }
    if (subject === "deals") {
      return {
        text:
          "No deal system is available in this simulation yet. Deal talk can still be sent as a direct message, but nothing enforces it.",
        gap: true
      };
    }
    if (subject === "events") {
      const events = recentEvents(this.state, seat, player.lastTurnActed);
      const messages = this.delivered.get(seat) ?? [];
      return {
        text: JSON.stringify(
          {
            events: events.slice(-12).map((event) => ({ turn: event.turn, kind: event.kind, detail: event.detail })),
            messages: messages.map((message) => ({ from: message.from, text: message.text }))
          },
          null,
          1
        )
      };
    }
    return { text: "Unknown subject '" + subject + "'", gap: true };
  }

  // Carry out a seat's committed actions.
  commit(seat: string, actions: SimCommitAction[]): string[] {
    return applyCommit(this.state, seat, actions);
  }

  // The line describing the treasury, happiness and research obligations.
  private currentLine(player: SimSeat): string {
    const techs = researchOptions(player);
    const policies = availablePolicies(player.policies, 3);
    const researchName = player.currentResearch ?? "none chosen";
    const researchTurns = player.currentResearch
      ? Math.max(1, Math.ceil((techCost(player.techs.length, this.config) - player.researchProgress) / Math.max(1, player.sciencePerTurn)))
      : 0;
    const policyTurns = Math.max(
      1,
      Math.ceil((policyCost(player.policies.length, this.config) - player.policyProgress) / Math.max(1, player.culturePerTurn))
    );
    return (
      "* Treasury: " +
      player.gold +
      " (+" +
      goldPerTurn(player, this.config) +
      "/turn). Happiness: " +
      (player.happiness >= 0 ? "Happy" : "Unhappy") +
      ". Research: " +
      researchName +
      (player.currentResearch ? " (Estimated in " + researchTurns + " turns)" : "") +
      ". Research must name ONE exact technology from: " +
      techs.join(", ") +
      ". Next policy in " +
      policyTurns +
      " turns" +
      (player.policyAvailable ? " (READY NOW)" : "") +
      ". Policy must name ONE exact entry from: " +
      policies.join("; ") +
      "."
    );
  }

  // The line describing the seat's cities.
  private citiesLine(player: SimSeat): string {
    return (
      "* Cities (" +
      player.cities.length +
      "): population " +
      totalPopulation(player) +
      ", territory " +
      totalTerritory(player) +
      ", military strength " +
      player.militaryStrength +
      ", units " +
      player.units +
      " (supply " +
      player.militarySupply +
      "), score " +
      player.score +
      "."
    );
  }

  // What a seat can see of a rival.
  private rivalLine(seat: string, rival: SimSeat): string {
    const known = rival.relationships[seat];
    const met = known ? known.metOnTurn <= this.state.turn : false;
    if (!met) return "* " + rival.civ + " visible: nothing seen yet.";
    const research = rival.currentResearch ?? "unknown";
    return (
      "* " +
      rival.civ +
      " visible: era " +
      rival.era +
      ", score " +
      rival.score +
      ", treasury ~" +
      Math.round(rival.gold) +
      ", research " +
      research +
      ", " +
      rival.cities.length +
      " cities, military " +
      rival.militaryStrength +
      "."
    );
  }

  // The messages a seat is being shown this turn.
  private messagesSection(seat: string): string {
    const messages = this.delivered.get(seat) ?? [];
    const header =
      "Messages for you (reply with communicate if warranted, up to 8 social operations per turn in one communicate call):";
    if (messages.length === 0) return header + "\n- None.";
    const lines = messages.map((message) => {
      const scope = message.scope === "world" || message.scope === null ? "public" : "private";
      return "- [" + scope + ", turn " + this.state.turn + "] " + message.from + ": " + (message.text ?? "(no text)");
    });
    return header + "\n" + lines.join("\n");
  }

  // The groups a seat belongs to or has been invited to.
  private groupsSection(seat: string): string {
    const groups = this.groups.get(seat) ?? [];
    const header =
      "Groups for you (up to 8 social operations per turn; send all of them in one communicate operations array 'group:<id>'):";
    if (groups.length === 0) return header + "\n- Member of no groups.";
    const lines = groups.map((group) => {
      const membership = group.members.includes(seat) ? "member" : "invited";
      return "- " + group.name + " (" + membership + ", members: " + group.members.join(", ") + ")";
    });
    return header + "\n" + lines.join("\n");
  }

  // Everything a seat can see about itself.
  private selfDetail(player: SimSeat): string {
    const technologies = availableTechs(player.techs, 5);
    return JSON.stringify(
      {
        Civilization: player.civ,
        Leader: player.leader,
        IsMajor: true,
        Score: player.score,
        Era: player.era,
        Technologies: player.techs.length,
        NextPolicyTurns: Math.max(
          1,
          Math.ceil(
            (policyCost(player.policies.length, this.config) - player.policyProgress) /
              Math.max(1, culturePerTurn(player, this.config))
          )
        ),
        Cities: player.cities.length,
        Population: totalPopulation(player),
        Territory: totalTerritory(player),
        Gold: player.gold,
        GoldPerTurn: goldPerTurn(player, this.config),
        HappinessSituation: player.happiness >= 0 ? "Happy" : "Unhappy",
        HappinessPercentage: Math.max(0, 100 + player.happiness * 10),
        MilitaryUnits: player.units,
        MilitarySupply: player.militarySupply,
        MilitaryStrength: player.militaryStrength,
        SciencePerTurn: sciencePerTurn(player, this.config),
        CulturePerTurn: culturePerTurn(player, this.config),
        GrandStrategy: player.grandStrategy,
        availableTechnologies: technologies
      },
      null,
      1
    );
  }

  // Everything a seat can see about research.
  private researchDetail(player: SimSeat, detail?: string): string {
    if (detail) {
      return JSON.stringify(
        { Technology: detail, Cost: techCost(player.techs.length, this.config), Progress: player.researchProgress },
        null,
        1
      );
    }
    return JSON.stringify(
      {
        Current: player.currentResearch,
        Progress: player.researchProgress,
        Cost: techCost(player.techs.length, this.config),
        SciencePerTurn: sciencePerTurn(player, this.config),
        Known: player.techs,
        availableTechnologies: availableTechs(player.techs, 5)
      },
      null,
      1
    );
  }

  // Everything a seat can see about its cities.
  private citiesDetail(player: SimSeat): string {
    return JSON.stringify(
      {
        Cities: player.cities.map((city) => ({
          Name: city.name,
          Population: city.population,
          Territory: city.tiles,
          Production: city.production,
          ProductionTurnsLeft: city.productionTurnsLeft,
          GrowthProgress: city.growthProgress,
          GrowthNeeded: city.growthNeeded,
          BuildOptions: buildOptions.map((option) => option.name)
        })),
        Era: eraForTechCount(player.techs.length)
      },
      null,
      1
    );
  }

  // Everything a seat can see about its relationships.
  private diplomacyDetail(seat: string, detail?: string): string {
    const player = this.state.seats[seat];
    const others = this.state.order.filter((name) => name !== seat);
    if (detail) {
      const target = others.find((name) => name === detail || this.state.seats[name].civ.toLowerCase() === detail.toLowerCase());
      if (!target) return JSON.stringify({ error: "no such seat at this table", seen: others });
      const relation = player.relationships[target];
      return JSON.stringify(
        {
          Civ: this.state.seats[target].civ,
          Public: relation?.publicValue ?? 0,
          Private: relation?.privateValue ?? 0,
          AtWar: relation?.atWar ?? false,
          MetOnTurn: relation?.metOnTurn ?? null
        },
        null,
        1
      );
    }
    const rows: Record<string, unknown> = {};
    for (const name of others) {
      const relation = player.relationships[name];
      rows[this.state.seats[name].civ] = {
        Public: relation?.publicValue ?? 0,
        Private: relation?.privateValue ?? 0,
        AtWar: relation?.atWar ?? false
      };
    }
    return JSON.stringify(rows, null, 1);
  }
}
