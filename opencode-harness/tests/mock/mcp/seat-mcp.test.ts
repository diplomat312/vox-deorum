// Covers how one seat's tool server reads its environment, which is the piece
// that decides whether a seat has a world at all: a snapshot of a generated
// game, a corpus of a recorded one, or the live game itself.

import { describe, expect, it } from "vitest";
import { readEnvironment, readLiveSeats } from "../../../src/mcp/seat-mcp.js";

// The variables every seat needs, so a test only varies the world it is given.
const base = { SEAT: "korea", SOCIAL_DIR: "social", STATE_FILE: "current-turn.json" };

describe("the seat tool server's environment", () => {
  it("should read a live table as seat and player pairs", () => {
    expect(readLiveSeats("korea:0,austria:1, siam:2 ")).toEqual([
      { seat: "korea", playerID: 0 },
      { seat: "austria", playerID: 1 },
      { seat: "siam", playerID: 2 }
    ]);
  });

  it("should ignore a pair it cannot read rather than guessing", () => {
    expect(readLiveSeats("korea:0,nonsense,:3,austria")).toEqual([{ seat: "korea", playerID: 0 }]);
    expect(readLiveSeats("")).toEqual([]);
  });

  it("should take a live table as the world a seat reads", () => {
    const reading = readEnvironment({ ...base, PLAYERS: "korea:0,austria:1" });

    expect(reading.ok).toBe(true);
    if (reading.ok) expect(reading.config.liveSeats).toHaveLength(2);
  });

  it("should still take a generated or a recorded game", () => {
    expect(readEnvironment({ ...base, WORLD_STATE_FILE: "state.json" }).ok).toBe(true);
    expect(readEnvironment({ ...base, CORPUS_DIR: "corpus" }).ok).toBe(true);
  });

  it("should refuse a seat with no world at all, naming the three ways to give one", () => {
    const reading = readEnvironment({ ...base });

    expect(reading.ok).toBe(false);
    if (!reading.ok) {
      expect(reading.error).toContain("CORPUS_DIR");
      expect(reading.error).toContain("WORLD_STATE_FILE");
      expect(reading.error).toContain("PLAYERS");
    }
  });

  it("should name every missing variable at once", () => {
    const reading = readEnvironment({});

    expect(reading.ok).toBe(false);
    if (!reading.ok) {
      for (const name of ["SEAT", "SOCIAL_DIR", "STATE_FILE"]) expect(reading.error).toContain(name);
    }
  });
});

