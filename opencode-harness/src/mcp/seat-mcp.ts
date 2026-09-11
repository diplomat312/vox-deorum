// The runnable entry point for one seat's tool server.
//
// OpenCode starts this file as a local MCP server, so everything the seat needs
// arrives in the environment. It builds the server for one seat and connects it
// over stdio. stdout belongs to the MCP protocol, so the single fatal line this
// file may print goes to stderr and nothing else is ever written.

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RecordedWorld } from "../world/recorded-world.js";
import { SimulatedWorld } from "../world/simulated/simulated-world.js";
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
}

// Stop with one clear line on stderr. stderr is the only stream this process
// may write on anything other than the MCP protocol.
function fail(message: string): never {
  process.stderr.write(message + "\n");
  process.exit(1);
}

// Read the configuration from the environment. A missing required variable is
// reported as one message naming every variable that is absent, so an operator
// sees the whole problem at once. GAME is a label and is never required.
function readEnvironment(): EntryPointConfig {
  const missing = requiredVariables.filter((name) => (process.env[name] ?? "").trim() === "");
  if (missing.length > 0) {
    fail(
      "vox-civ seat server cannot start: missing required environment variable(s): " +
        missing.join(", ") +
        ". Required: " +
        requiredVariables.join(", ") +
        ". Optional: GAME."
    );
  }
  const game = (process.env.GAME ?? "").trim();
  const corpusDirectory = (process.env.CORPUS_DIR ?? "").trim();
  const worldStateFile = (process.env.WORLD_STATE_FILE ?? "").trim();
  if (corpusDirectory === "" && worldStateFile === "") {
    fail(
      "vox-civ seat server cannot start: set CORPUS_DIR for a recorded game or WORLD_STATE_FILE for a generated one."
    );
  }
  return {
    seat: (process.env.SEAT ?? "").trim(),
    corpusDirectory,
    worldStateFile,
    socialDirectory: (process.env.SOCIAL_DIR ?? "").trim(),
    stateFile: (process.env.STATE_FILE ?? "").trim(),
    game: game === "" ? undefined : game
  };
}

// Build the seat's server from the game it is playing and connect it over stdio.
// A generated game is rebuilt per call from its snapshot, because the harness
// owns the game and advances it between calls. A recorded game is read once,
// because it never changes.
async function main(): Promise<void> {
  const config = readEnvironment();
  const world =
    config.worldStateFile !== ""
      ? () => SimulatedWorld.fromSnapshot(config.worldStateFile, config.socialDirectory)
      : await RecordedWorld.fromDirectory(config.corpusDirectory);
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
main().catch((error: unknown) => {
  fail("vox-civ seat server cannot start: " + (error instanceof Error ? error.message : String(error)));
});
