// Plays seats against a real game.
//
// The seat runtime is unchanged from the simulated path, which is the whole
// point of the world seam: the same four tools, the same trace, the same
// report, against the game rather than a generated world. What differs is where
// the state comes from and that the writes are the game's own actions.
//
// Nothing here launches Civilization V. The run expects a game already running
// with its MCP server answering, and a live session is therefore started by a
// person rather than by this file.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SeatRuntime, type PendingDecision } from "../seat/runtime.js";
import { SeatPacer } from "../seat/pacing.js";
import { OpenCodeServer } from "../session/opencode-server.js";
import { SessionClient } from "../session/session-client.js";
import type { SeatModel } from "../session/types.js";
import { TraceStore } from "../trace/store.js";
import type { TraceRecord } from "../trace/types.js";
import { logger } from "../utils/logger.js";
import { LiveWorld, type LiveSeat } from "../world/live/live-world.js";
import { HttpVoxConnector } from "../world/live/vox-connector.js";
import { McpGameClock } from "../world/live/mcp-game-clock.js";
import { writeSeatConfig } from "./seat-config.js";
import { writeTurnState } from "./turn-state.js";

// The tools every live read and write depends on. A run checks for them before
// its first turn, because discovering a missing tool on turn forty wastes a
// game rather than a minute.
export const requiredVoxTools = [
  "get-players",
  "get-cities",
  "get-military-report",
  "get-options",
  "get-victory-progress",
  "get-opinions",
  "get-events",
  "get-diplomatic-events",
  "set-research",
  "set-policy",
  "set-relationship",
  "set-strategy",
  "keep-status-quo"
];

// Everything a live run needs.
export interface LiveRunOptions {
  // Where the run writes.
  runDirectory: string;
  // A short name for the run.
  runId: string;
  // The seats this run controls, with their player indices.
  seats: LiveSeat[];
  // The names to introduce each seat by.
  names?: Record<string, { civ: string; leader: string }>;
  // The model every seat runs on.
  model: SeatModel;
  // Per-seat model overrides.
  modelOverrides?: Record<string, SeatModel>;
  // The built tool server entry point.
  serverEntry: string;
  // The port a seat's OpenCode server starts from.
  portBase: number;
  // How many turns to play.
  turns: number;
  // How long a seat turn may take.
  turnTimeoutMs?: number;
  // The MCP endpoint, when it is not the repository default.
  mcpEndpoint?: string;
  // How a seat's thinking relates to the game clock.
  //
  // The freeze policy is the default, because it is the one that cannot produce
  // a stale decision: the game is held for the whole turn and released after it.
  //
  // The overlap policy lets the game run while a seat thinks and holds it only
  // to commit, which keeps a long game moving at the cost of decisions that may
  // land on a state that moved. Those are checked, and dropped when the world
  // has drifted further than a decision can survive.
  pacing?: "freeze" | "overlap" | "none";
  // How far the game may move past the state a seat read before its decision is
  // dropped rather than committed, in turns. One means a decision survives the
  // game advancing by a turn while the seat thought, which is the point of the
  // overlap policy, and nothing more.
  maxDriftTurns?: number;
}

// What a finished live run reports.
export interface LiveRunResult {
  // The run identifier.
  runId: string;
  // Turns played across seats.
  turnsPlayed: number;
  // Turns a seat failed to finish.
  failures: number;
  // Seats that could not be started.
  unavailable: string[];
  // How the game was held, so a run says what it paced rather than leaving it
  // to be inferred from timing.
  pacing: "freeze" | "overlap" | "none";
  // Holds the game took, and holds it did not.
  holdsTaken: number;
  holdsMissed: number;
  // How each paced turn ended: committed as the seat reached it, revalidated
  // against a state that had moved, or dropped before it was sent. A dropped
  // decision is counted here rather than inferred from timing.
  verdicts: Record<string, number>;
}

// Check the tools a live run depends on, and say what is missing.
export async function preflight(connector: { listTools(): Promise<string[]> }): Promise<string[]> {
  const available = await connector.listTools();
  return requiredVoxTools.filter((tool) => !available.includes(tool));
}

// Check that the game itself is ready, not only that its tools exist.
//
// The tools answer long before a game is loaded, and a knowledge read against
// an unloaded game fails with the server's own message rather than returning
// state. Starting a run in that condition wastes a session producing empty
// briefings and committing actions into nothing, so it is checked here instead.
//
// The probe is the first seat's player read, which is the one read every turn
// depends on and the only one whose refusal is unambiguous.
export async function checkGameReady(
  connector: { call(name: string, args?: Record<string, unknown>): Promise<{ text: string; isError: boolean }> },
  firstSeatPlayerID: number | null
): Promise<string | null> {
  if (firstSeatPlayerID === null) return null;
  const result = await connector.call("get-players", { PlayerID: firstSeatPlayerID }).catch((error) => ({
    text: "the call failed: " + (error instanceof Error ? error.message : String(error)),
    isError: true
  }));
  if (!result.isError) return null;
  return (
    "The game is not ready to be played. Reading the first seat answered: " +
    result.text.slice(0, 300) +
    ". A live run needs a game already loaded, because every turn begins with that read."
  );
}

// Play the seats against the running game.
export async function runLive(options: LiveRunOptions): Promise<LiveRunResult> {
  if (options.seats.length === 0) throw new Error("A live run needs at least one seat");
  const socialDirectory = path.join(options.runDirectory, "social");
  const traceDirectory = path.join(options.runDirectory, "trace");
  await mkdir(socialDirectory, { recursive: true });
  const store = new TraceStore(traceDirectory, options.runId);
  const connector = new HttpVoxConnector(options.mcpEndpoint);
  await connector.connect().catch((failure) => {
    // A run that cannot reach the server has nothing to say about the game, so
    // the message names the address rather than repeating the transport error.
    throw new Error(
      "Could not reach the Vox MCP server at " +
        (options.mcpEndpoint ?? "the repository default") +
        " (" +
        (failure instanceof Error ? failure.message : String(failure)) +
        "). A live run needs the server running with a game loaded."
    );
  });
  const missing = await preflight(connector);
  if (missing.length > 0) {
    throw new Error("The game is missing tools this run needs: " + missing.join(", "));
  }
  const notReady = await checkGameReady(connector, options.seats[0]?.playerID ?? null);
  if (notReady) throw new Error(notReady);
  logger.info("The game answered a read, so it is loaded and ready to play");
  const world = new LiveWorld({
    connector,
    seats: options.seats,
    game: options.runId,
    names: options.names
  });

  const servers: OpenCodeServer[] = [];
  const seatServers = new Map<string, { server: OpenCodeServer; port: number; directory: string }>();
  const unavailable: string[] = [];
  const clients = new Map<string, SessionClient>();
  try {
    for (let index = 0; index < options.seats.length; index += 1) {
      const seat = options.seats[index].seat;
      try {
        const seatDirectory = path.join(options.runDirectory, "seats", seat);
        await writeSeatConfig({
          seat,
          playerID: options.seats[index].playerID,
          model: options.modelOverrides?.[seat] ?? options.model,
          seatDirectory,
          corpusDirectory: "",
          socialDirectory,
          serverEntry: options.serverEntry
        });
        const server = new OpenCodeServer(seatDirectory);
        await server.start({ port: options.portBase + index });
        servers.push(server);
        seatServers.set(seat, { server, port: options.portBase + index, directory: seatDirectory });
        const client = new SessionClient(server.address(), options.modelOverrides?.[seat] ?? options.model, {}, {
          turnTimeoutMs: options.turnTimeoutMs
        });
        await client.openSeat(seat, "seat " + seat);
        clients.set(seat, client);
        logger.info("Seat " + seat + " is ready on port " + (options.portBase + index));
      } catch (failure) {
        const detail = failure instanceof Error ? failure.message : String(failure);
        unavailable.push(seat);
        logger.error("Seat " + seat + " could not start and will sit this run out: " + detail);
      }
    }
    const playing = options.seats.filter((seat) => !unavailable.includes(seat.seat));
    if (playing.length === 0) throw new Error("No seat could be started, so there is no run to play");

    const runtimes = new Map<string, SeatRuntime>();
    for (const seat of playing) {
      runtimes.set(
        seat.seat,
        new SeatRuntime({
          client: clients.get(seat.seat) as SessionClient,
          world,
          socialDirectory,
          store,
          toolServing: "observe",
          onTurnFailed: async (failedSeat: string, error: string) => {
            const held = seatServers.get(failedSeat);
            if (!held) return "none" as const;
            if (held.server.isAlive()) {
              try {
                await clients.get(failedSeat)?.abort(failedSeat);
                return "aborted" as const;
              } catch {
                // fall through to replacing the session
              }
            }
            logger.warn("Replacing the session for seat " + failedSeat + " after: " + error);
            await held.server.stop().catch(() => undefined);
            const replacement = new OpenCodeServer(held.directory);
            await replacement.start({ port: held.port });
            seatServers.set(failedSeat, { ...held, server: replacement });
            servers.push(replacement);
            const client = new SessionClient(
              replacement.address(),
              options.modelOverrides?.[failedSeat] ?? options.model,
              {},
              { turnTimeoutMs: options.turnTimeoutMs }
            );
            await client.openSeat(failedSeat, "seat " + failedSeat + " (restarted)");
            clients.set(failedSeat, client);
            runtimes.get(failedSeat)?.setClient(client);
            return "reset" as const;
          }
        })
      );
    }

    let turnsPlayed = 0;
    let failures = 0;
    // How the run held the game, so its summary can say what was paced.
    let holdsTaken = 0;
    let holdsMissed = 0;
    const verdicts: Record<string, number> = {};
    const pacing = options.pacing ?? "freeze";
    const maxDriftTurns = options.maxDriftTurns ?? 1;
    // The clock is the game's, and the pacer is the one tested offline: it
    // confirms a hold rather than trusting it, releases whatever happens, keeps
    // the hold inside a budget, and checks a decision that landed on a state
    // that moved.
    const clock = new McpGameClock(connector, options.seats[0]?.playerID ?? 0);
    const pacer = new SeatPacer({ clock, policy: pacing });
    for (let turn = 1; turn <= options.turns; turn += 1) {
      for (const seat of playing) {
        const seatDirectory = path.join(options.runDirectory, "seats", seat.seat);
        await writeTurnState(seatDirectory, { turn, seat: seat.seat });
        const runtime = runtimes.get(seat.seat) as SeatRuntime;
        let recorded: TraceRecord | null = null;
        const paced = await pacer.playTurn<PendingDecision>({
          seat: seat.seat,
          turn,
          decide: (reasonedTurn) => runtime.decideTurn(seat.seat, reasonedTurn),
          // A decision stands when the world has not moved far past the state the
          // seat read. Beyond that its read is worthless and it is dropped rather
          // than acted on, because a seat must never act on a situation it never saw.
          stillValid: async () => {
            const now = await clock.turn().catch(() => turn);
            return now - turn <= maxDriftTurns;
          },
          commit: async (pending) => {
            recorded = await runtime.commitTurn(pending);
          },
          // A dropped decision was still a turn the seat played. It is written
          // down without being sent, so the run shows the turn and says plainly
          // that nothing came of it.
          onDropped: async (pending, _commitTurn, verdict) => {
            recorded = await runtime.commitTurn(pending, {
              apply: false,
              applied: "decision dropped before it was sent: " + verdict
            });
          }
        });
        if (paced.outcome.frozenForCognition || paced.outcome.frozenForCommit) holdsTaken += 1;
        // A freeze that never took is worth counting, because it means a seat
        // acted on a state the game was free to change while it thought.
        if (pacing === "freeze" && !paced.outcome.frozenForCognition) holdsMissed += 1;
        verdicts[paced.outcome.verdict] = (verdicts[paced.outcome.verdict] ?? 0) + 1;
        turnsPlayed += 1;
        const written = recorded as TraceRecord | null;
        if (!written) {
          // The pacer always hands a decision to one of its two callbacks, so a
          // turn with no record means the recording path itself failed, which is
          // worth saying loudly rather than losing quietly.
          failures += 1;
          logger.warn("turn " + turn + " " + seat.seat + " produced no record at all");
        } else {
          if (written.outcome === "failed" || written.outcome === "unfinished") failures += 1;
          logger.info("turn " + turn + " " + seat.seat + " " + written.outcome + " | " + (written.applied ?? ""));
        }
      }
    }
    const summary = await store.summary();
    await writeFile(
      path.join(options.runDirectory, "summary.json"),
      JSON.stringify(
        { ...summary, failures, unavailable, pacing, holdsTaken, holdsMissed, verdicts },
        null,
        2
      ),
      "utf8"
    );
    return {
      runId: options.runId,
      turnsPlayed,
      failures,
      unavailable,
      pacing,
      holdsTaken,
      holdsMissed,
      verdicts
    };
  } finally {
    for (const server of servers) {
      await server.stop().catch((error) => logger.warn("Could not stop a seat server: " + String(error)));
    }
    await connector.close().catch((error) => logger.warn("Could not close the game connection: " + String(error)));
  }
}

// Read the run from the command line and play it.
//
// Seats are given as name:playerIndex pairs, because a live game is addressed
// by player index and the harness needs to know which seat is which.
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (name: string, fallback?: string): string | undefined => {
    const at = args.indexOf("--" + name);
    return at === -1 ? fallback : args[at + 1];
  };
  const repositoryRoot = path.resolve(value("root", ".") as string);
  const runId = value("run-id", "live-" + new Date().toISOString().replace(/[:.]/g, "-")) as string;
  const runDirectory = path.resolve(value("run-dir", path.join(repositoryRoot, "opencode-harness/runs", runId)) as string);
  const seats = ((value("seats", "") as string) || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [seat, playerID] = entry.split(":");
      return { seat, playerID: Number(playerID) };
    });
  if (seats.length === 0) throw new Error("Name the seats to control, as name:playerIndex pairs");
  if (seats.some((seat) => !Number.isFinite(seat.playerID))) {
    throw new Error("Every seat needs a player index, written as name:playerIndex");
  }
  const modelSetting = (value("model", "opencode-go/deepseek-v4.1-flash") as string).split("/");
  const result = await runLive({
    runDirectory,
    runId,
    seats,
    model: { providerID: modelSetting[0], modelID: modelSetting.slice(1).join("/") },
    serverEntry: path.resolve(value("server", path.join(repositoryRoot, "opencode-harness/dist/mcp/seat-mcp.js")) as string),
    portBase: Number(value("port-base", "5800")),
    turns: Number(value("turns", "10")),
    turnTimeoutMs: Number(value("turn-timeout", "150000")),
    mcpEndpoint: value("mcp", undefined) as string | undefined
    ,
    pacing: paceFrom(value("pacing", "freeze") as string)
    ,
    maxDriftTurns: Number(value("max-drift", "1"))
  });
  logger.info(
    "Live run " +
      result.runId +
      " finished: " +
      result.turnsPlayed +
      " turn(s), " +
      result.failures +
      " unfinished or failed" +
      (result.unavailable.length > 0 ? ", seats that never started: " + result.unavailable.join(", ") : "") +
      ", pacing " +
      result.pacing +
      " with " +
      result.holdsTaken +
      " hold(s) taken and " +
      result.holdsMissed +
      " missed" +
      (result.verdicts.dropped ? ", " + result.verdicts.dropped + " decision(s) dropped" : "")
  );
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith("live.js")) {
  await main().catch((error: unknown) => {
    logger.error("The live run could not continue: " + (error instanceof Error ? error.message : String(error)));
    process.exit(1);
  });
}

// Read the pacing policy from what a person typed, refusing anything unknown
// rather than silently falling back, because a run that paces differently from
// what was asked for is a run whose results cannot be trusted.
export function paceFrom(value: string): "freeze" | "overlap" | "none" {
  const wanted = value.trim().toLowerCase();
  if (wanted === "overlap" || wanted === "none" || wanted === "freeze") return wanted;
  throw new Error("Unknown pacing policy '" + value + "'. Use freeze, overlap or none.");
}
