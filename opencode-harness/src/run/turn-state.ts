// The small file that tells a seat's tool server which turn is being played.
// One seat keeps one OpenCode session and one tool server process for a whole
// game, so the turn cannot be fixed in the environment. The harness writes this
// file before each observation and the tool server reads it on every call.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// The state a tool server needs in order to answer for the current turn.
export interface TurnState {
  // The turn being played.
  turn: number;
  // The seat playing it.
  seat: string;
}

// The name of the state file inside a seat's working directory.
export const turnStateFileName = "current-turn.json";

// The path of the state file for a seat working directory.
export function turnStatePath(seatDirectory: string): string {
  return path.join(seatDirectory, turnStateFileName);
}

// Write the turn a seat is about to play.
export async function writeTurnState(seatDirectory: string, state: TurnState): Promise<void> {
  await mkdir(seatDirectory, { recursive: true });
  await writeFile(turnStatePath(seatDirectory), JSON.stringify(state), "utf8");
}

// Read the turn a seat is playing. Returns null when the file is missing or
// unreadable, which is what a tool server refuses a call over.
export async function readTurnState(seatDirectory: string): Promise<TurnState | null> {
  try {
    const text = await readFile(turnStatePath(seatDirectory), "utf8");
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed.turn !== "number" || typeof parsed.seat !== "string") return null;
    return { turn: parsed.turn, seat: parsed.seat };
  } catch {
    return null;
  }
}
