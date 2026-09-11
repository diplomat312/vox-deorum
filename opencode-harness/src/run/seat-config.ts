// Builds the OpenCode configuration for one seat.
// A seat gets its own working directory and its own tool server process, so
// two seats never share a session, a working directory or a log. The seat is
// also stripped of everything except the civ tools: no shell, no filesystem,
// no web, no subagents. That confinement is what makes an autonomous seat safe
// to leave running.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SeatModel } from "../session/types.js";

// Everything needed to configure one seat.
export interface SeatConfigOptions {
  // The seat name, for example "korea".
  seat: string;
  // The seat's player index in the game.
  playerID: number | null;
  // The model the seat should run on.
  model: SeatModel;
  // The directory the seat works in, which is also its project root.
  seatDirectory: string;
  // The harvested fixture directory the tool server answers from.
  corpusDirectory: string;
  // Path of the snapshot of a generated game, when the seat plays one instead
  // of a recorded game.
  worldStateFile?: string;
  // Where the run keeps its social log.
  socialDirectory: string;
  // The built tool server entry point.
  serverEntry: string;
}

// The permissions a seat is denied. Everything denied here is a capability the
// model is not meant to have, so the list is explicit rather than a default.
const deniedPermissions = [
  "bash",
  "edit",
  "write",
  "read",
  "glob",
  "grep",
  "webfetch",
  "websearch",
  "task",
  "skill"
];

// Build the OpenCode configuration object for a seat.
export function seatConfig(options: SeatConfigOptions): Record<string, unknown> {
  const permission: Record<string, string> = {};
  for (const name of deniedPermissions) permission[name] = "deny";
  return {
    $schema: "https://opencode.ai/config.json",
    model: options.model.providerID + "/" + options.model.modelID,
    permission,
    mcp: {
      "vox-civ": {
        type: "local",
        command: [process.execPath, options.serverEntry],
        environment: {
          SEAT: options.seat,
          CORPUS_DIR: options.corpusDirectory,
          WORLD_STATE_FILE: options.worldStateFile ?? "",
          SOCIAL_DIR: options.socialDirectory,
          STATE_FILE: path.join(options.seatDirectory, "current-turn.json"),
          ...(options.playerID === null ? {} : { PLAYER_ID: String(options.playerID) })
        },
        enabled: true
      }
    }
  };
}

// Create the seat's working directory and write its configuration, then return
// the directory so the server can be started in it.
export async function writeSeatConfig(options: SeatConfigOptions): Promise<string> {
  await mkdir(options.seatDirectory, { recursive: true });
  const file = path.join(options.seatDirectory, "opencode.json");
  await writeFile(file, JSON.stringify(seatConfig(options), null, 2), "utf8");
  return options.seatDirectory;
}
