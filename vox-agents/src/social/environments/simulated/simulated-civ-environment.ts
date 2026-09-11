// The generated world attached to the social environment.
//
// The environment already abstracts the world a conversation is about behind
// SocialEnvironmentPort: it asks for a briefing, asks which actions are legal, and
// hands back what happened. This is another implementation of that port, and the
// world behind it is the simulation in the harness rather than a running game.
//
// Two things make it worth having. It runs with no Civilization V, so a question
// about diplomacy can be asked in a minute rather than an evening. And the world
// it presents is a game rather than a room: seats have treasuries, armies and
// neighbours, a neighbour massing troops on your border is a thing you can see,
// and a war takes cities. That is the part a chat window does not have.
//
// The one mechanism worth naming is the wake. A seat is not asked to speak on a
// timer; it is woken when something happened to it, which is what a turn in this
// game is. A table where nothing happens wakes nobody, and a table where a
// neighbour's army appears on the border wakes the neighbour.

import { z } from "zod";
import type { SocialActor } from "../../types.js";
import type { DecisionToolDefinition } from "../../runtime/social-decision-tools.js";
import type { SocialEnvironmentActionResult, SocialEnvironmentPort } from "../../runtime/social-environment-port.js";
import { createLogger } from "../../../utils/logger.js";
import { loadSimulatedCivEngine, SimulatedCivWorld, type SimulatedCivEngine } from "./simulated-civ-world.js";

/** Everything the environment needs to start. */
export interface SimulatedCivEnvironmentOptions {
  // The seats at the table, in order, which are also the actor ids.
  seats: string[];
  // The seed the world is generated from, so a run can be replayed.
  seed: number;
  // A label for the game, used in the briefing and the logs.
  game: string;
  // Who is played by a person rather than a model, and so is never woken.
  humanActorId?: string;
  // How long the world holds still between turns, in milliseconds.
  tickMs?: number;
  // Ask the social runtime to wake one seat.
  enqueue: (actorId: string, reason: string) => Promise<void>;
  // Circumstances to inject on chosen turns, which is how an experiment is set up.
  script?: Array<{ turn: number; order: string; seat: string; args: Record<string, unknown> }>;
}

// How long the world holds still between turns when nobody says otherwise.
const defaultTickMs = 45000;

// What one seat can ask to read.
const inspectSubjects = ["self", "army", "neighbours", "diplomacy"] as const;

// The world a conversation in this environment is about, as the runtime sees it.
export class SimulatedCivEnvironment implements SocialEnvironmentPort {
  private readonly logger = createLogger("simulated-civ");
  private readonly world: SimulatedCivWorld;
  private readonly seats: string[];
  private readonly humanActorId: string | undefined;
  private readonly tickMs: number;
  private readonly enqueue: SimulatedCivEnvironmentOptions["enqueue"];
  private readonly script: Array<{ turn: number; order: string; seat: string; args: Record<string, unknown> }>;
  // How far into the event log each seat has been told about.
  private readonly told = new Map<string, number>();
  // The timer that moves the world on.
  private timer: NodeJS.Timeout | null = null;
  // True once the environment has been closed, so a tick in flight stops.
  private closed = false;

  private constructor(engine: SimulatedCivEngine, options: SimulatedCivEnvironmentOptions) {
    this.world = new SimulatedCivWorld(engine, options.seats, options.seed, options.game);
    this.seats = options.seats;
    this.humanActorId = options.humanActorId;
    this.tickMs = options.tickMs ?? defaultTickMs;
    this.enqueue = options.enqueue;
    this.script = options.script ?? [];
    // Every seat already knows the table; what it does not know is what the
    // others are doing, which is the thing worth finding out.
    this.useSocialMemory = true;
  }

  // Keep compatibility memory, because remembering a conversation is the point of
  // a persistent seat.
  readonly useSocialMemory: boolean;

  /** Build the environment, which is asynchronous because the engine is loaded lazily. */
  public static async start(options: SimulatedCivEnvironmentOptions): Promise<SimulatedCivEnvironment> {
    const engine = await loadSimulatedCivEngine();
    return new SimulatedCivEnvironment(engine, options);
  }

  /** Wake the table once and begin moving the world on. */
  public async open(): Promise<void> {
    for (const seat of this.seats) {
      this.told.set(seat, 0);
      if (seat === this.humanActorId) continue;
      await this.wake(seat, "the game has begun");
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, this.tickMs);
    // A timer must not keep a process alive on its own.
    if (typeof this.timer.unref === "function") this.timer.unref();
    this.logger.info("A generated world is running: " + this.world.seats.join(", ") + ", a turn every " + this.tickMs + "ms");
  }

  /** Move the world one turn and wake whoever it happened to. */
  public async tick(): Promise<void> {
    if (this.closed) return;
    const turn = this.world.state.turn + 1;
    // The mark is taken before anything happens, so a scripted order counts as
    // news of this turn and the seat it was done to is woken by it.
    const mark = this.world.eventCount;
    // A scripted circumstance is what makes a run an experiment rather than a
    // sample: a neighbour masses on a border on a turn the caller chose.
    for (const order of this.script.filter((entry) => entry.turn === turn)) {
      const result = this.world.apply(order.seat, order.order, order.args);
      this.logger.info("Injected at turn " + turn + ": " + order.order + " for " + order.seat + (result.taken ? "" : " (refused: " + result.reason + ")"));
    }
    const events = this.world.advanceFrom(mark);
    // Each seat is told what happened to it, and only that.
    for (const seat of this.seats) {
      if (seat === this.humanActorId) continue;
      const forSeat = events.filter((event) => event.seat === null || event.seat === seat);
      if (forSeat.length === 0) continue;
      const latest = forSeat[forSeat.length - 1];
      await this.wake(seat, latest?.detail ?? "something happened");
    }
  }

  /** The briefing one seat reads, which is the whole of what the world tells it. */
  public async contextForActor(actor: SocialActor): Promise<string | undefined> {
    const seat = actor.id;
    if (!this.world.state.seats[seat]) return undefined;
    const lines: string[] = [];
    const civ = this.world.civOf(seat);
    lines.push("You are " + civ + ". It is turn " + this.world.state.turn + " of the game.");
    lines.push("");
    lines.push("Your position:");
    for (const line of this.world.ownPosition(seat)) lines.push("- " + line);
    lines.push("");
    lines.push("The table:");
    for (const line of this.world.tableLine(seat)) lines.push(line);
    const fresh = this.world.eventsSince(this.told.get(seat) ?? 0, seat);
    lines.push("");
    lines.push("Since you last looked:");
    if (fresh.length === 0) lines.push("- Nothing new recorded.");
    for (const event of fresh.slice(-12)) lines.push("- [turn " + event.turn + "] " + event.detail);
    // The mark moves here, because the briefing is how a seat is told.
    this.told.set(seat, this.world.eventCount);
    lines.push("");
    lines.push(
      "You may read more with civ_inspect. Then choose exactly one action, taking a step in the game, speaking to the table, or saying nothing."
    );
    return lines.join("\n");
  }

  /** The verbs this seat may use, which are the game's own high-level knobs. */
  public async decisionDefinitionsForActor(actor: SocialActor): Promise<DecisionToolDefinition[]> {
    if (!this.world.state.seats[actor.id]) return [];
    const neighbours = this.world.neighbours(actor.id).map((seat) => this.world.civOf(seat));
    const ids = this.world.neighbours(actor.id).join(", ");
    return [
      {
        name: "civ_inspect",
        actionName: "inspect",
        description: "Read more about your position, your army, your neighbours, or how the table regards you.",
        inputSchema: z.object({ subject: z.enum(inspectSubjects) }),
        phase: "support"
      },
      {
        name: "civ_mass_troops",
        actionName: "mass_troops",
        description:
          "Move part of your army to a border, or bring it home. Your neighbours on that border can see it happen and cannot see why. Facing: " +
          neighbours.join(", ") +
          " (ids: " +
          ids +
          "). Committed is the share of your army from 0 to 1. A build-up counts as one while it stays put.",
        inputSchema: z.object({ facing: z.string().nullable(), committed: z.number().min(0).max(1) })
      },
      {
        name: "civ_declare_war",
        actionName: "declare_war",
        description: "Declare war on a neighbour you border. The whole table hears it, and your standing with everyone falls.",
        inputSchema: z.object({ target: z.string() })
      },
      {
        name: "civ_attack",
        actionName: "attack",
        description: "Attack a neighbour you are at war with, using whatever part of your army is facing them. A beaten defence can lose a city.",
        inputSchema: z.object({ target: z.string() })
      },
      {
        name: "civ_make_peace",
        actionName: "make_peace",
        description: "End a war with a seat you are at war with.",
        inputSchema: z.object({ target: z.string() })
      },
      {
        name: "civ_set_research",
        actionName: "set_research",
        description: "Point your scholars at one technology.",
        inputSchema: z.object({ technology: z.string() })
      },
      {
        name: "civ_set_policy",
        actionName: "set_policy",
        description: "Adopt a social policy, when one is ready.",
        inputSchema: z.object({ policy: z.string() })
      },
      {
        name: "civ_set_posture",
        actionName: "set_posture",
        description:
          "Record how you regard another seat, publicly and privately. This outlasts anything you say, and the other seat can see where you stand on them.",
        inputSchema: z.object({
          target: z.string(),
          public: z.number().min(-5).max(5).optional(),
          private: z.number().min(-8).max(8).optional()
        })
      }
    ];
  }

  /** Carry out one order in the game. */
  public async execute(
    actor: SocialActor,
    _sourceTurn: number,
    actionName: string,
    argumentsValue: Record<string, unknown>,
    _operationId: string
  ): Promise<SocialEnvironmentActionResult> {
    const result = this.world.apply(actor.id, actionName, argumentsValue);
    if (!result.taken) {
      // A refusal is the world's answer, not an error, so it is handed back as
      // one and the runtime records it as a refused outcome rather than a loss.
      throw new Error("the world refused: " + (result.reason ?? "no reason given"));
    }
    return { state: result.detail ?? "done" };
  }

  /** Answer one read, which is free and never counts as the turn's action. */
  public async read(
    actor: SocialActor,
    _sourceTurn: number,
    actionName: string,
    argumentsValue: Record<string, unknown>,
    _operationId: string
  ): Promise<string> {
    if (actionName !== "inspect") return "There is no reading called " + actionName + ".";
    const seat = actor.id;
    const subject = typeof argumentsValue.subject === "string" ? argumentsValue.subject : "self";
    if (!this.world.state.seats[seat]) return "You are not at this table.";
    if (subject === "self") return this.world.ownPosition(seat).join("\n");
    if (subject === "army") {
      const lines = [this.world.armyLine(seat) + "."];
      for (const other of this.world.seats) {
        if (other === seat) continue;
        const seen = this.world.seenArmy(seat, other);
        lines.push(
          seen.massed
            ? this.world.civOf(other) + " has about " + seen.estimate + " massed on your border, for " + seen.turnsFacing + " turns."
            : this.world.civOf(other) + " shows no army on your border."
        );
      }
      return lines.join("\n");
    }
    if (subject === "neighbours") {
      return this.world
        .neighbours(seat)
        .map((other) => this.world.civOf(other) + " (id " + other + ") borders you")
        .join("\n");
    }
    return this.world.tableLine(seat).join("\n");
  }

  /** Stop the world and release its timer. */
  public async close(): Promise<void> {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // Wake one seat, telling it why in the record rather than in its briefing.
  private async wake(actorId: string, reason: string): Promise<void> {
    try {
      await this.enqueue(actorId, reason);
    } catch (error) {
      this.logger.warn("Could not wake " + actorId, { error });
    }
  }
}
