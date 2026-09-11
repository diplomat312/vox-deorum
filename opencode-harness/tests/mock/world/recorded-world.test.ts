// Covers the world a seat reads from: the literal form tests build by hand, and
// the harvested corpus the benchmark replays.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RecordedWorld } from "../../../src/world/recorded-world.js";
import type { WorldTurn } from "../../../src/world/types.js";

// Build one turn of the test game, so each test varies only what it checks.
function turn(overrides: Partial<WorldTurn> = {}): WorldTurn {
  return {
    game: "test-game",
    seat: "korea",
    playerID: 0,
    turn: 1,
    session: "ses_test",
    observation: "TURN 1 observation",
    toolCalls: [],
    modelText: null,
    decision: "commit",
    ...overrides
  };
}

// Directory holding the harvested fixtures that ship with the package.
const corpusDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "corpus",
  "fresh4"
);

describe("recorded world", () => {
  it("should list seats in the order they first appear", () => {
    const world = new RecordedWorld([
      turn({ seat: "korea" }),
      turn({ seat: "siam", playerID: 2 }),
      turn({ seat: "korea", turn: 2 })
    ]);

    expect(world.seats()).toEqual([
      { seat: "korea", playerID: 0, session: "ses_test" },
      { seat: "siam", playerID: 2, session: "ses_test" }
    ]);
  });

  it("should return a seat's turns in ascending order", () => {
    const world = new RecordedWorld([
      turn({ turn: 9 }),
      turn({ turn: 3 }),
      turn({ turn: 7 })
    ]);

    expect(world.turns("korea")).toEqual([3, 7, 9]);
  });

  it("should return null for a turn it does not hold", () => {
    const world = new RecordedWorld([turn()]);

    expect(world.turn("korea", 99)).toBeNull();
    expect(world.turn("nowhere", 1)).toBeNull();
    expect(world.turns("nowhere")).toEqual([]);
  });

  it("should refuse to hand over an observation it does not hold", () => {
    const world = new RecordedWorld([turn()]);

    expect(() => world.observation("korea", 99)).toThrowError(/No recorded turn for seat 'korea' at turn 99/);
  });

  it("should refuse turns that belong to different games", () => {
    expect(() => new RecordedWorld([turn(), turn({ game: "other-game" })])).toThrowError(/one game label/);
  });

  it("should refuse to build a world with no turns", () => {
    expect(() => new RecordedWorld([])).toThrowError(/at least one recorded turn/);
  });

  it("should serve the harvested four-seat game", async () => {
    const world = await RecordedWorld.fromDirectory(corpusDirectory);

    expect(world.game).toBe("fresh4");
    expect(world.seats().map((seat) => seat.seat)).toEqual(["austria", "iroquois", "korea", "siam"]);

    const koreaTurns = world.turns("korea");
    expect(koreaTurns[0]).toBe(1);
    expect(koreaTurns).toEqual([...koreaTurns].sort((left, right) => left - right));

    const firstObservation = world.observation("korea", 1);
    expect(firstObservation.startsWith("TURN 1 (live game fresh4)")).toBe(true);
    expect(firstObservation).toContain("You are Sejong, leader of Korea");
  });
});
