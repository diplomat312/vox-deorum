// Covers the war and geography the generated world was missing.
//
// The point of this layer is that a neighbour massing troops is a fact one seat
// can see and the intent behind it is not, so these tests are mostly about what
// is visible rather than about who wins.

import { describe, expect, it } from "vitest";
import { createSimState, defaultSimConfig } from "../../../src/world/simulated/engine.js";
import {
  areNeighbours,
  createWarState,
  declareWar,
  makePeace,
  massTroops,
  massedAgainst,
  neighboursOf,
  resolveAttack,
  visibleArmy
} from "../../../src/world/simulated/war.js";

// The four seats the recorded game used.
const seats = ["korea", "austria", "siam", "iroquois"];

// A fresh four-seat world.
function world(): ReturnType<typeof createSimState> {
  return createSimState({ seats, seed: 11, game: "war-test" });
}

describe("the geography of the table", () => {
  it("should give every seat two neighbours and no more", () => {
    const state = world();

    for (const seat of seats) {
      const neighbours = neighboursOf(state, seat);
      expect(neighbours).toHaveLength(2);
      expect(neighbours).not.toContain(seat);
    }
  });

  it("should make bordering a shared fact", () => {
    const state = world();

    // The relation is symmetric, which is what lets both sides of a border be
    // told the same thing about each other.
    expect(areNeighbours(state, "korea", "austria")).toBe(areNeighbours(state, "austria", "korea"));
    expect(areNeighbours(state, "korea", "siam")).toBe(false);
  });
});

describe("massing an army", () => {
  it("should tell the seat whose border it is", () => {
    const state = world();
    const war = createWarState(state);

    const result = massTroops(state, war, "austria", "korea", 0.8);

    expect(result.taken).toBe(true);
    // The neighbour is told an army is there, which is the whole mechanism: a
    // build-up is visible and the reason for it is not.
    const told = state.events.filter((event) => event.seat === "korea" && event.kind === "army-nearby");
    expect(told).toHaveLength(1);
    expect(told[0].detail).toContain("Austria");
    expect(told[0].detail).toContain("80%");
  });

  it("should refuse to mass against a seat that is not on the border", () => {
    const state = world();
    const war = createWarState(state);

    const result = massTroops(state, war, "korea", "siam", 0.5);

    expect(result.taken).toBe(false);
    expect(result.reason).toContain("does not border");
  });

  it("should count how long an army has been in place and restart on a new target", () => {
    const state = world();
    const war = createWarState(state);

    massTroops(state, war, "austria", "korea", 0.5);
    massTroops(state, war, "austria", "korea", 0.6);
    expect(war.austria.turnsFacing).toBe(2);

    // A march to the other border is a new build-up, not a continued one. Austria
    // sits between Korea and Siam, so Siam is the neighbour that is left.
    expect(neighboursOf(state, "austria")).toContain("siam");
    massTroops(state, war, "austria", "siam", 0.6);
    expect(war.austria.turnsFacing).toBe(1);
  });

  it("should show the observer what is in front of it and no more", () => {
    const state = world();
    const war = createWarState(state);
    massTroops(state, war, "austria", "korea", 1);

    const seen = visibleArmy(state, war, "korea", "austria");

    expect(seen.massed).toBe(true);
    expect(seen.estimate).toBe(Math.round(state.seats.austria.militaryStrength));
    // Siam is not on this border, so it sees nothing massed against it.
    expect(visibleArmy(state, war, "siam", "austria").massed).toBe(false);
    expect(massedAgainst(war, "austria", "siam")).toBe(0);
  });

  it("should bring an army home", () => {
    const state = world();
    const war = createWarState(state);
    massTroops(state, war, "austria", "korea", 1);

    massTroops(state, war, "austria", null, 0);

    expect(massedAgainst(war, "austria", "korea")).toBe(0);
    expect(visibleArmy(state, war, "korea", "austria").massed).toBe(false);
  });
});

describe("war", () => {
  it("should make a declaration public and cost the aggressor regard", () => {
    const state = world();

    const result = declareWar(state, "austria", "korea");

    expect(result.taken).toBe(true);
    expect(state.seats.korea.relationships.austria.atWar).toBe(true);
    expect(state.seats.austria.relationships.korea.atWar).toBe(true);
    // Everyone hears it, so standing falls with the whole table and not only
    // with the victim.
    for (const seat of seats) {
      if (seat === "austria") continue;
      expect(state.seats[seat].relationships.austria.publicValue).toBeLessThan(0);
    }
  });

  it("should refuse a war with a seat that is not on the border", () => {
    const state = world();

    expect(declareWar(state, "korea", "siam").taken).toBe(false);
    expect(declareWar(state, "korea", "austria").taken).toBe(true);
    // Declaring twice is a mistake rather than a second war.
    expect(declareWar(state, "korea", "austria").taken).toBe(false);
  });

  it("should let both sides end a war", () => {
    const state = world();
    declareWar(state, "austria", "korea");

    expect(makePeace(state, "korea", "austria").taken).toBe(true);
    expect(state.seats.korea.relationships.austria.atWar).toBe(false);
    expect(makePeace(state, "korea", "austria").taken).toBe(false);
  });
});

describe("a battle", () => {
  it("should reward the side that massed and cost the side that did not", () => {
    const state = world();
    const war = createWarState(state);
    // A deliberate mismatch: a whole army against a neighbour holding nothing.
    state.seats.austria.militaryStrength = 60;
    state.seats.korea.militaryStrength = 20;
    massTroops(state, war, "austria", "korea", 1);

    const battle = resolveAttack(state, war, "austria", "korea", 0.5);

    expect(battle.won).toBe(true);
    expect(battle.attackerStrength).toBe(60);
    // A defender at home still fights, but only partly.
    expect(battle.defenderStrength).toBe(Math.round(20 * 0.35 * 10) / 10);
    expect(state.seats.korea.relationships.austria.privateValue).toBeLessThan(0);
  });

  it("should let a prepared defender hold", () => {
    const state = world();
    const war = createWarState(state);
    state.seats.austria.militaryStrength = 30;
    state.seats.korea.militaryStrength = 60;
    massTroops(state, war, "austria", "korea", 1);
    massTroops(state, war, "korea", "austria", 1);

    const battle = resolveAttack(state, war, "austria", "korea", 0.5);

    expect(battle.won).toBe(false);
    expect(battle.captured).toBeNull();
  });

  it("should take a city from a beaten defence and tell the whole table", () => {
    const state = world();
    const war = createWarState(state);
    // Give the defender somewhere to lose that is not its capital.
    state.seats.korea.cities.push({ ...state.seats.korea.cities[0], name: "Busan" });
    state.seats.austria.militaryStrength = 90;
    state.seats.korea.militaryStrength = 10;
    massTroops(state, war, "austria", "korea", 1);
    const before = state.seats.korea.cities.length;

    const battle = resolveAttack(state, war, "austria", "korea", 1);

    expect(battle.captured).toBe("Busan");
    expect(state.seats.korea.cities).toHaveLength(before - 1);
    expect(state.seats.austria.cities.some((city) => city.name === "Busan")).toBe(true);
    // A third seat hears how the war is going, which is how a coalition forms
    // around something other than a rumour.
    expect(state.events.some((event) => event.seat === "siam" && event.kind === "battle-heard")).toBe(true);
  });

  it("should never take a seat's last city", () => {
    const state = world();
    const war = createWarState(state);
    state.seats.austria.militaryStrength = 400;
    state.seats.korea.militaryStrength = 1;
    massTroops(state, war, "austria", "korea", 1);

    const battle = resolveAttack(state, war, "austria", "korea", 1);

    // A war takes ground; it does not delete a seat from the table, because the
    // table is what this bench exists to study.
    expect(battle.captured).toBeNull();
    expect(state.seats.korea.cities.length).toBeGreaterThan(0);
  });
});

describe("what the layer leaves alone", () => {
  it("should not change a world nobody has given an order in", () => {
    const state = world();
    const war = createWarState(state);

    // An untouched table has no armies anywhere, which is what keeps the
    // threat in a briefing a fact rather than background noise.
    for (const seat of seats) expect(massedAgainst(war, seat, "korea")).toBe(0);
    expect(state.seats.korea.relationships.austria.atWar).toBe(false);
    expect(defaultSimConfig.militaryPerTurn).toBeGreaterThan(0);
  });
});
