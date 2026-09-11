// The runnable entry point for one seat's tool server.
//
// OpenCode starts this file as a local MCP server, so everything the seat needs
// arrives in the environment. It builds the server for one seat and connects it
// over stdio. stdout belongs to the MCP protocol, so the single fatal line this
// file may print goes to stderr and nothing else is ever written.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { RecordedWorld } from "../world/recorded-world.js";
import { SimulatedWorld } from "../world/simulated/simulated-world.js";
import { HttpVoxConnector } from "../world/live/vox-connector.js";
import { LiveWorld, type LiveSeat } from "../world/live/live-world.js";
import { createSeatServer } from "./seat-server.js";

// The variables a seat's server cannot run without.
const requiredVariables = ["SEAT", "SOCIAL_DIR", "STATE_FILE"] as const;

// What the entry point read out of the environment, or the one line that says
// what is missing.
interface EntryPointConfig {
  // The seat this server answers for.
  seat: string;
  // Directory of harvested fixtures, when the seat is playing a recorded game.
  corpusDirectory: string;
  // Path of the snapshot of a generated game, when the seat is playing one.
  worldStateFile: string;
  // Directory holding this run's social log and this seat's tool call log.
  socialDirectory: string;
  // Path of the file naming the turn being played.
  stateFile: string;
  // A label for the game, when the harness set one.
  game: string | undefined;
  // The seats of a live game, when this seat is playing one. A live seat has no
  // snapshot to read: its world is the game itself, reached over the Vox MCP
  // server, which is also where its social operations belong.
  liveSeats: LiveSeat[];
}

// Read the seats of a live game out of the environment, as "seat:playerID"
// pairs. An empty or unreadable value means this seat is not playing a live
// game, which is how the factory below chooses a world.
export function readLiveSeats(value: string): LiveSeat[] {
  const seats: LiveSeat[] = [];
  for (const pair of value.split(",")) {
    const [seat, playerID] = pair.split(":");
    if (!seat || playerID === undefined) continue;
    const index = Number(playerID);
    if (!Number.isInteger(index)) continue;
    seats.push({ seat: seat.trim(), playerID: index });
  }
  return seats;
}

// Stop with one clear line on stderr. stderr is the only stream this process
// may write on anything other than the MCP protocol.
function fail(message: string): never {
  process.stderr.write(message + "\n");
  process.exit(1);
}

// What the environment yielded: a configuration, or the one line that says what
// is wrong with it. Reporting the problem rather than exiting here is what lets
// the entry point be tested without killing the process that loaded it.
export type EnvironmentReading = { ok: true; config: EntryPointConfig } | { ok: false; error: string };

// Read the configuration from the environment. A missing required variable is
// reported as one message naming every variable that is absent, so an operator
// sees the whole problem at once. GAME is a label and is never required.
export function readEnvironment(env: NodeJS.ProcessEnv = process.env): EnvironmentReading {
  const missing = requiredVariables.filter((name) => (env[name] ?? "").trim() === "");
  if (missing.length > 0) {
    return {
      ok: false,
      error:
        "vox-civ seat server cannot start: missing required environment variable(s): " +
        missing.join(", ") +
        ". Required: " +
        requiredVariables.join(", ") +
        ". Optional: GAME."
    };
  }
  const game = (env.GAME ?? "").trim();
  const corpusDirectory = (env.CORPUS_DIR ?? "").trim();
  const worldStateFile = (env.WORLD_STATE_FILE ?? "").trim();
  const liveSeats = readLiveSeats((env.PLAYERS ?? "").trim());
  if (corpusDirectory === "" && worldStateFile === "" && liveSeats.length === 0) {
    return {
      ok: false,
      error:
        "vox-civ seat server cannot start: set CORPUS_DIR for a recorded game, WORLD_STATE_FILE for a generated one, or PLAYERS for a live one."
    };
  }
  const config: EntryPointConfig = {
    seat: (env.SEAT ?? "").trim(),
    corpusDirectory,
    worldStateFile,
    socialDirectory: (env.SOCIAL_DIR ?? "").trim(),
    stateFile: (env.STATE_FILE ?? "").trim(),
    game: game === "" ? undefined : game,
    liveSeats
  };
  return { ok: true, config };
}

// Build the seat's server from the game it is playing and connect it over stdio.
// A generated game is rebuilt per call from its snapshot, because the harness
// owns the game and advances it between calls. A recorded game is read once,
// because it never changes.
async function main(): Promise<void> {
  const reading = readEnvironment();
  if (!reading.ok) fail(reading.error);
  const config = reading.config;
  // A live seat's world is the game, so its reads, its messages and its deals
  // all go where every other caller's do. A generated or recorded game has no
  // such place and is rebuilt or read from the snapshot the harness publishes.
  let world;
  if (config.liveSeats.length > 0) {
    const connector = new HttpVoxConnector();
    await connector.connect();
    world = new LiveWorld({
      connector,
      seats: config.liveSeats,
      game: config.game,
      names: {},
      socialDirectory: config.socialDirectory
    });
  } else if (config.worldStateFile !== "") {
    world = () => SimulatedWorld.fromSnapshot(config.worldStateFile, config.socialDirectory);
  } else {
    world = await RecordedWorld.fromDirectory(config.corpusDirectory);
  }
  const server = createSeatServer({
    seat: config.seat,
    world,
    socialDirectory: config.socialDirectory,
    stateFile: config.stateFile,
    game: config.game
  });
  await server.connect(new StdioServerTransport());
}

// A start that cannot finish is a fatality, not a partial run: the seat would
// otherwise sit in a session with no tools behind it.
//
// The server is started only when this file is the process entry point, so that
// importing it to cover how it reads its environment does not start a server.
const entryPoint = process.argv[1];
if (entryPoint !== undefined && pathToFileURL(entryPoint).href === import.meta.url) {
  main().catch((error: unknown) => {
    fail("vox-civ seat server cannot start: " + (error instanceof Error ? error.message : String(error)));
  });
}
