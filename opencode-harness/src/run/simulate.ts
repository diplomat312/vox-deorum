// Plays a simulated game: several seats, each an OpenCode session, all reading
// a recorded game while talking to each other for real.
//
// Nothing here launches Civilization V. The material world comes from the
// recorded fixture, so two runs face identical situations, and the diplomacy
// layer is live, so what the seats say to each other genuinely changes what
// the later turns look like for each other.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { SeatRuntime } from "../seat/runtime.js";
import { OpenCodeServer } from "../session/opencode-server.js";
import { SessionClient } from "../session/session-client.js";
import type { SeatModel } from "../session/types.js";
import { TraceStore } from "../trace/store.js";
import { RecordedWorld } from "../world/recorded-world.js";
import { logger } from "../utils/logger.js";
import { writeSeatConfig } from "./seat-config.js";
import { writeTurnState } from "./turn-state.js";

// Everything a simulated run needs.
export interface SimulationOptions {
  // The harvested fixture directory the seats read.
  corpusDirectory: string;
  // Where the run writes its files.
  runDirectory: string;
  // A short name for the run, used in the record and the logs.
  runId: string;
  // The seats to play. Empty means every seat the fixture holds.
  seats: string[];
  // The first turn to play.
  fromTurn: number;
  // The last turn to play.
  toTurn: number;
  // The model every seat runs on unless it is overridden.
  model: SeatModel;
  // Per-seat model overrides, keyed by seat name.
  modelOverrides?: Record<string, SeatModel>;
  // The built tool server entry point the seats are given.
  serverEntry: string;
  // The port each seat's OpenCode server starts from. Each seat takes the next
  // port, so several seats can run at once without colliding.
  portBase: number;
}

// What a finished run reports.
export interface SimulationResult {
  // The run identifier.
  runId: string;
  // Turns actually played, across every seat.
  turnsPlayed: number;
  // Turns a seat failed to finish.
  failures: number;
  // Information the seats asked for and did not get, counted by subject.
  gaps: Record<string, number>;
}

// Play the seats through the recorded window.
export async function simulate(options: SimulationOptions): Promise<SimulationResult> {
  const world = await RecordedWorld.fromDirectory(options.corpusDirectory);
  const allSeats = world.seats().map((seat) => seat.seat);
  const seats = options.seats.length > 0 ? options.seats.filter((seat) => allSeats.includes(seat)) : allSeats;
  if (seats.length === 0) {
    throw new Error("None of the requested seats exist in " + options.corpusDirectory);
  }

  const socialDirectory = path.join(options.runDirectory, "social");
  const traceDirectory = path.join(options.runDirectory, "trace");
  await mkdir(socialDirectory, { recursive: true });
  const store = new TraceStore(traceDirectory, options.runId);

  // One OpenCode server per seat, because each seat needs its own tool server
  // and its own working directory. A shared server would let two seats see
  // each other's configuration.
  const servers: OpenCodeServer[] = [];
  const clients = new Map<string, SessionClient>();
  try {
    for (let index = 0; index < seats.length; index += 1) {
      const seat = seats[index];
      const seatDirectory = path.join(options.runDirectory, "seats", seat);
      const playerID = world.seats().find((entry) => entry.seat === seat)?.playerID ?? null;
      await writeSeatConfig({
        seat,
        playerID,
        model: options.modelOverrides?.[seat] ?? options.model,
        seatDirectory,
        corpusDirectory: options.corpusDirectory,
        socialDirectory,
        serverEntry: options.serverEntry
      });
      const server = new OpenCodeServer(seatDirectory);
      await server.start({ port: options.portBase + index });
      servers.push(server);
      const client = new SessionClient(server.address(), options.modelOverrides?.[seat] ?? options.model);
      await client.openSeat(seat, "seat " + seat);
      clients.set(seat, client);
      logger.info("Seat " + seat + " is ready on port " + (options.portBase + index));
    }

    const runtimes = new Map<string, SeatRuntime>();
    for (const seat of seats) {
      runtimes.set(
        seat,
        new SeatRuntime({
          client: clients.get(seat) as SessionClient,
          world,
          socialDirectory,
          store,
          toolServing: "observe"
        })
      );
    }

    let turnsPlayed = 0;
    let failures = 0;
    const gaps: Record<string, number> = {};
    for (let turn = options.fromTurn; turn <= options.toTurn; turn += 1) {
      for (const seat of seats) {
        if (world.turn(seat, turn) === null) continue;
        const seatDirectory = path.join(options.runDirectory, "seats", seat);
        await writeTurnState(seatDirectory, { turn, seat });
        const runtime = runtimes.get(seat) as SeatRuntime;
        const record = await runtime.playTurn(seat, turn);
        turnsPlayed += 1;
        if (record.outcome === "failed" || record.outcome === "unfinished") failures += 1;
        for (const subject of extractGaps(record.applied ?? "")) {
          gaps[subject] = (gaps[subject] ?? 0) + 1;
        }
        logger.info(
          "turn " +
            turn +
            " " +
            seat +
            " " +
            record.outcome +
            " (cache read " +
            record.usage.cacheRead +
            ", in " +
            record.usage.input +
            ", out " +
            record.usage.output +
            ", reasoning " +
            record.usage.reasoning +
            ")"
        );
      }
    }

    const summary = await store.summary();
    await writeFile(
      path.join(options.runDirectory, "summary.json"),
      JSON.stringify({ ...summary, failures, gaps }, null, 2),
      "utf8"
    );
    return { runId: options.runId, turnsPlayed, failures, gaps };
  } finally {
    for (const server of servers) {
      await server.stop().catch((error) => logger.warn("Could not stop a seat server: " + String(error)));
    }
  }
}

// Pull the subjects a seat asked for and did not get out of a record's applied
// line, so a run can report what the observation is missing.
function extractGaps(applied: string): string[] {
  const marker = "information gaps: ";
  const at = applied.indexOf(marker);
  if (at === -1) return [];
  return applied
    .slice(at + marker.length)
    .split(", ")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

// Read command line options and play a run. This is the entry point used from
// the console, so it stays forgiving about paths and loud about what it did.
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (name: string, fallback?: string): string | undefined => {
    const at = args.indexOf("--" + name);
    return at === -1 ? fallback : args[at + 1];
  };
  const repositoryRoot = path.resolve(value("root", ".") as string);
  const corpusDirectory = path.resolve(value("corpus", path.join(repositoryRoot, "opencode-harness/corpus/fresh4")) as string);
  const runId = value("run-id", "sim-" + new Date().toISOString().replace(/[:.]/g, "-")) as string;
  const runDirectory = path.resolve(value("run-dir", path.join(repositoryRoot, "opencode-harness/runs", runId)) as string);
  const seats = (value("seats", "") as string).split(",").map((seat) => seat.trim()).filter(Boolean);
  const fromTurn = Number(value("from", "1"));
  const toTurn = Number(value("to", "3"));
  const portBase = Number(value("port-base", "4200"));
  const modelSetting = (value("model", "opencode-go/deepseek-v4.1-flash") as string).split("/");
  const serverEntry = path.resolve(
    value("server", path.join(repositoryRoot, "opencode-harness/dist/mcp/seat-mcp.js")) as string
  );
  const result = await simulate({
    corpusDirectory,
    runDirectory,
    runId,
    seats,
    fromTurn,
    toTurn,
    model: { providerID: modelSetting[0], modelID: modelSetting.slice(1).join("/") },
    serverEntry,
    portBase
  });
  logger.info(
    "Run " +
      result.runId +
      " finished: " +
      result.turnsPlayed +
      " turn(s), " +
      result.failures +
      " unfinished or failed, gaps " +
      JSON.stringify(result.gaps)
  );
  process.exit(0);
}

// Only run when invoked as a program, so importing this file in a test does
// not start a game.
if (process.argv[1] && process.argv[1].endsWith("simulate.js")) {
  await main();
}
