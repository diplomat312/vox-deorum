// A World backed by a real game through Vox Deorum's MCP server.
//
// The material world is the game's, and the seats read it and write to it
// exactly as any other caller does, through the MCP tools. Nothing here invents
// state and nothing reaches the game by any other route, so action legality and
// logging stay where they already live.
//
// The synchronous parts of the World seam are served from a snapshot: beginTurn
// performs the reads, and observation and the cached answers are reads of what
// was fetched. That keeps the seat runtime identical between a simulated game
// and a real one, which is the point of having a seam at all.

import type { InspectAnswer, SeatInfo, World } from "../types.js";
import type { DealOperation, DecisionOutcome } from "../types.js";
import type { VoxConnector } from "./vox-connector.js";
import { LiveDeals } from "./live-deals.js";
import { logger } from "../../utils/logger.js";

// A seat at a real table.
export interface LiveSeat {
  // The seat name the harness uses, such as "korea".
  seat: string;
  // The player index in the game, which every read and write is addressed by.
  playerID: number;
}

// Everything a live world needs to start.
export interface LiveWorldOptions {
  // The open connection to the game.
  connector: VoxConnector;
  // The seats the run controls.
  seats: LiveSeat[];
  // A label for the game, used in the observation header.
  game?: string;
  // Names for the seats, meaning civilization and leader, so an observation can
  // introduce a seat to itself the way the live game's own prose does.
  names?: Record<string, { civ: string; leader: string }>;
}

// The reason a tool gave for refusing, kept short enough for a record.
//
// A refusal may carry a structured error, as the game's own actions do, or
// only prose. Both are reduced to one line so a run's report can say why an
// action was not taken without carrying a whole payload.
export function refusalReason(text: string): string {
  try {
    const parsed = JSON.parse(text) as { Error?: { Message?: unknown }; message?: unknown };
    if (parsed !== null && typeof parsed === "object") {
      const message = parsed.Error?.Message ?? parsed.message;
      if (typeof message === "string" && message.length > 0) return message.slice(0, 160);
    }
  } catch {
    // Not JSON, so the text itself is the reason.
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 160);
}

// Whether a tool's answer was the game refusing what it was asked to do.
//
// A refusal reaches the harness in two shapes, and only one of them looks like
// a failure. Some tools mark the call as an error, and others answer
// successfully with a payload whose Success flag is false, which is how the game
// reports an action it will not take. Reading only the error flag would log a
// refused action as applied, so a run would claim to have set a technology the
// game rejected.
export function refusedByGame(result: { text: string; isError: boolean }): boolean {
  if (result.isError) return true;
  try {
    const parsed = JSON.parse(result.text) as { Success?: unknown };
    if (parsed !== null && typeof parsed === "object" && parsed.Success === false) return true;
  } catch {
    // A body that is not JSON cannot carry a refusal flag.
  }
  return false;
}

// Read a field out of a tool's text, which Vox returns as JSON.
function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Render a value for an observation line: objects become compact JSON, and
// anything else is written as it is.
function show(value: unknown): string {
  if (value === null || value === undefined) return "unknown";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

// Serves a real game.
export class LiveWorld implements World {
  // The label for this game.
  readonly game: string;

  // The connection the seats reach the game through.
  private readonly connector: VoxConnector;

  // The seats this run controls.
  private readonly seatList: LiveSeat[];

  // The names to introduce each seat by.
  private readonly names: Record<string, { civ: string; leader: string }>;

  // The game's own deal system, which is where a live deal is settled.
  private readonly deals: LiveDeals;

  // The observation built for the turn a seat is about to play.
  private readonly prepared = new Map<string, string>();

  // The answers fetched for the turn in progress, so an inspect the seat makes
  // is served from what was already read where possible.
  private readonly reads = new Map<string, Record<string, unknown>>();

  // Build a live world over an open connection.
  constructor(options: LiveWorldOptions) {
    this.connector = options.connector;
    this.seatList = options.seats;
    this.names = options.names ?? {};
    this.game = options.game ?? "live";
    const players: Record<string, number> = {};
    for (const seat of this.seatList) players[seat.seat] = seat.playerID;
    this.deals = new LiveDeals(this.connector, players);
  }

  // The seats this run controls.
  seats(): SeatInfo[] {
    return this.seatList.map((seat) => ({ seat: seat.seat, playerID: seat.playerID, session: null }));
  }

  // The names a seat answers to in a live game, so a message aimed at a
  // civilization or a leader is delivered rather than refused over wording.
  aliases(): Record<string, string> {
    const names: Record<string, string> = {};
    for (const seat of this.seatList) {
      names[seat.seat.toLowerCase()] = seat.seat;
      const named = this.names[seat.seat];
      if (named) {
        names[named.civ.toLowerCase()] = seat.seat;
        names[named.leader.toLowerCase()] = seat.seat;
      }
    }
    return names;
  }

  // Whether a seat can be played. A live run plays until its caller stops
  // asking, so any seat it controls has a turn.
  hasTurn(seat: string): boolean {
    return this.seatList.some((entry) => entry.seat === seat);
  }

  // Fetch everything this seat's observation needs, then render it. A read that
  // fails does not stop the turn: the section says it could not be read, which
  // is a fact the seat can act on rather than a reason to abandon the turn.
  async beginTurn(seat: string, turn: number): Promise<void> {
    const held = this.seatList.find((entry) => entry.seat === seat);
    if (!held) throw new Error("No seat named '" + seat + "' is in this run");
    const playerID = held.playerID;
    const reads: Record<string, unknown> = {};
    for (const [subject, call] of Object.entries(readCalls(playerID))) {
      reads[subject] = await this.read(call.tool, call.args);
    }
    // The deal thread comes from the game's own transcript rather than from the
    // run's log, so an offer another seat made is read where it was written.
    reads.deals = await this.deals.thread(seat).catch((error) => {
      logger.warn("Reading the deal thread for " + seat + " failed: " + String(error));
      return ["could not be read"];
    });
    this.reads.set(seat, reads);
    this.prepared.set(seat, this.render(seat, turn, reads));
  }

  // The observation built when the turn began.
  observation(seat: string, turn: number): string {
    const prepared = this.prepared.get(seat);
    if (!prepared) {
      throw new Error("Seat '" + seat + "' has no prepared observation for turn " + turn);
    }
    return prepared;
  }

  // Answer an inspect from the game. Anything already fetched for this turn is
  // answered from that, so a seat asking about its cities does not make the
  // server read them twice.
  async inspect(seat: string, _turn: number, subject: string, detail?: string): Promise<InspectAnswer> {
    const held = this.seatList.find((entry) => entry.seat === seat);
    if (!held) return { text: "No seat named '" + seat + "' is in this run", gap: true };
    const already = this.reads.get(seat)?.[subject];
    if (already !== undefined && detail === undefined) return { text: show(already) };
    const calls = inspectCalls(held.playerID, subject, detail);
    if (calls.length === 0) {
      return {
        text: "This subject has no reading in a live game: " + subject,
        gap: true
      };
    }
    const answers: string[] = [];
    for (const call of calls) answers.push(await this.readOnce(subject, call.tool, call.args, seat));
    return { text: answers.join("\n") };
  }

  // Settle one deal in the game's own deal system.
  //
  // A deal is the one social operation a world may have a better place for than
  // its own log, so it is offered to the world rather than assumed to belong to
  // the harness. Terms a seat cannot express honestly are refused here, which
  // gives the seat a reason it can read instead of a malformed deal the game
  // would reject without saying why.
  async applyDeal(seat: string, operation: DealOperation): Promise<DecisionOutcome> {
    return this.deals.apply(seat, operation);
  }

  // Carry out a committed decision as game actions.
  //
  // Every action is sent as the tool that owns it, so the game validates it and
  // the refusal comes back as the tool's own answer rather than as an error
  // invented here.
  async applyDecision(seat: string, actions: Array<Record<string, unknown>>): Promise<DecisionOutcome[]> {
    const held = this.seatList.find((entry) => entry.seat === seat);
    if (!held) return [];
    const outcomes: DecisionOutcome[] = [];
    for (const action of actions) {
      const call = writeCall(held.playerID, action);
      if (!call) {
        logger.warn("Seat " + seat + " asked for an action with no live equivalent: " + JSON.stringify(action.type));
        outcomes.push({
          type: String(action.type ?? "unknown"),
          taken: false,
          reason: "this action has no live equivalent, so it was not sent to the game"
        });
        continue;
      }
      const result = await this.connector.call(call.tool, call.args);
      // A refusal can arrive as an error or as a successful call whose payload
      // says the game did not take the action, so both are treated as a refusal
      // rather than reporting an action the game rejected as applied.
      if (refusedByGame(result)) {
        logger.warn("The game did not take " + call.tool + " for seat " + seat + ": " + result.text.slice(0, 200));
        outcomes.push({
          type: String(action.type ?? "unknown"),
          taken: false,
          reason: refusalReason(result.text)
        });
      } else {
        logger.info("Applied " + call.tool + " for seat " + seat);
        outcomes.push({ type: String(action.type ?? "unknown"), taken: true });
      }
    }
    return outcomes;
  }

  // Read a subject for the turn, recording it so an inspect can reuse it.
  private async read(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.connector.call(tool, args).catch((error) => ({ text: "read failed: " + String(error), isError: true }));
    return result.isError ? "could not be read" : parse(result.text);
  }

  // Read once more for an inspect that asks something the turn did not fetch.
  private async readOnce(subject: string, tool: string, args: Record<string, unknown>, seat: string): Promise<string> {
    const result = await this.connector
      .call(tool, args)
      .catch((error) => ({ text: "read failed: " + String(error), isError: true }));
    if (result.isError) logger.warn("Reading " + subject + " for seat " + seat + " failed: " + result.text.slice(0, 200));
    return result.isError ? "could not be read" : result.text;
  }

  // Render the observation from what was read.
  private render(seat: string, turn: number, reads: Record<string, unknown>): string {
    const held = this.seatList.find((entry) => entry.seat === seat) as LiveSeat;
    const named = this.names[seat];
    const others = this.seatList.filter((entry) => entry.seat !== seat);
    const lines: string[] = [];
    lines.push("TURN " + turn + " (live game " + this.game + ")");
    lines.push("");
    lines.push(
      named
        ? "You are " + named.leader + ", leader of " + named.civ + " (seat " + held.playerID + ")."
        : "You are seat " + held.playerID + " (" + seat + ")."
    );
    if (others.length > 0) {
      lines.push(
        "Other minds at the table: " +
          others
            .map((other) => (this.names[other.seat]?.civ ?? other.seat) + " (seat " + other.playerID + ")")
            .join("; ") +
          "."
      );
    }
    lines.push("");
    lines.push("Current:");
    lines.push("* Your position: " + show(reads.self));
    lines.push("* Cities: " + show(reads.cities));
    lines.push("* Military: " + show(reads.military));
    lines.push("* Research and policy: " + show(reads.research));
    lines.push("* Victory: " + show(reads.victory));
    lines.push("* Relationships: " + show(reads.diplomacy));
    lines.push("* Recent events: " + show(reads.events));
    lines.push("* Politics since your last opportunity: " + show(reads.politics));
    lines.push("");
    lines.push("Deal thread, read from the game's own transcript:");
    const threads = Array.isArray(reads.deals) ? (reads.deals as string[]) : [];
    if (threads.length === 0) lines.push("- Nothing on the table.");
    for (const line of threads) lines.push("- " + line);
    lines.push("");
    lines.push(
      "You may inspect anything else you need (inspect). When finished, commit your actions (commit_turn) or pass. Keep the rationale short."
    );
    return lines.join("\n");
  }
}

// The reads a turn fetches, and the tool each one uses.
export function readCalls(playerID: number): Record<string, { tool: string; args: Record<string, unknown> }> {
  return {
    self: { tool: "get-players", args: { PlayerID: playerID } },
    cities: { tool: "get-cities", args: { PlayerID: playerID } },
    military: { tool: "get-military-report", args: { PlayerID: playerID } },
    research: { tool: "get-options", args: { PlayerID: playerID } },
    victory: { tool: "get-victory-progress", args: { PlayerID: playerID } },
    diplomacy: { tool: "get-opinions", args: { PlayerID: playerID } },
    events: { tool: "get-events", args: { PlayerID: playerID } },
    politics: { tool: "get-diplomatic-events", args: { PlayerID: playerID, Formatted: true } }
  };
}

// The reads one inspect makes, which is how a subject a turn did not fetch is
// still answerable.
export function inspectCalls(
  playerID: number,
  subject: string,
  detail?: string
): Array<{ tool: string; args: Record<string, unknown> }> {
  const known = readCalls(playerID)[subject];
  if (known) return [known];
  if (subject === "deals") {
    // A deal can only be inspected against a counterpart, so the detail names
    // one seat and the tool is asked for the pairing.
    const peer = detail ? Number(detail) : Number.NaN;
    if (Number.isFinite(peer)) return [{ tool: "inspect-deal", args: { PlayerAID: playerID, PlayerBID: peer } }];
    return [];
  }
  return [];
}

// The game call one committed action becomes, or null when the action has no
// live equivalent and should be reported rather than silently dropped.
export function writeCall(
  playerID: number,
  action: Record<string, unknown>
): { tool: string; args: Record<string, unknown> } | null {
  const rationale = typeof action.rationale === "string" ? action.rationale : "committed through the harness";
  const type = action.type;
  if (type === "research" && typeof action.technology === "string") {
    return { tool: "set-research", args: { PlayerID: playerID, Technology: action.technology, Rationale: rationale } };
  }
  if (type === "policy" && typeof action.policy === "string") {
    return { tool: "set-policy", args: { PlayerID: playerID, Policy: action.policy, Rationale: rationale } };
  }
  if (type === "posture" && typeof action.target === "number") {
    const args: Record<string, unknown> = { PlayerID: playerID, TargetID: action.target, Rationale: rationale };
    if (typeof action.public === "number") args.Public = action.public;
    if (typeof action.private === "number") args.Private = action.private;
    return { tool: "set-relationship", args };
  }
  if (type === "strategy") {
    const args: Record<string, unknown> = { PlayerID: playerID, Rationale: rationale };
    if (typeof action.grand === "string") args.GrandStrategy = action.grand;
    if (Array.isArray(action.economic)) args.EconomicStrategies = action.economic;
    if (Array.isArray(action.military)) args.MilitaryStrategies = action.military;
    return { tool: "set-strategy", args };
  }
  if (type === "keep_status_quo") {
    const args: Record<string, unknown> = { PlayerID: playerID, Rationale: rationale };
    if (typeof action.mode === "string") args.Mode = action.mode;
    return { tool: "keep-status-quo", args };
  }
  return null;
}
