// Covers the generated environment: that it advances deterministically, that a
// seat's commitments change the world, and that injected circumstances reach
// the seats as news they can react to.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyOperations } from "../../../src/social/social-store.js";
import { advanceTurn, applyCommit, createSimState, defaultSimConfig, researchOptions, totalPopulation } from "../../../src/world/simulated/engine.js";
import { applyShocks } from "../../../src/world/simulated/scenario.js";
import { SimulatedWorld } from "../../../src/world/simulated/simulated-world.js";

// The four seats the recorded game used, so a run is comparable with it.
const seats = ["korea", "austria", "siam", "iroquois"];

describe("the generated environment", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "harness-sim-"));
  });

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("should produce the same game from the same seed", () => {
    const first = createSimState({ seats, seed: 7, game: "sim" });
    const second = createSimState({ seats, seed: 7, game: "sim" });
    for (let turn = 0; turn < 40; turn += 1) {
      advanceTurn(first, defaultSimConfig);
      advanceTurn(second, defaultSimConfig);
    }

    expect(first.seats.korea.score).toBe(second.seats.korea.score);
    expect(first.seats.korea.gold).toBe(second.seats.korea.gold);
    expect(totalPopulation(first.seats.korea)).toBe(totalPopulation(second.seats.korea));
    expect(first.events.map((event) => event.detail)).toEqual(second.events.map((event) => event.detail));
  });

  it("should grow a seat over time rather than standing still", () => {
    const state = createSimState({ seats, seed: 3, game: "sim" });
    const before = totalPopulation(state.seats.korea);
    for (let turn = 0; turn < 60; turn += 1) advanceTurn(state, defaultSimConfig);

    expect(totalPopulation(state.seats.korea)).toBeGreaterThan(before);
    expect(state.seats.korea.score).toBeGreaterThan(defaultSimConfig.startScore);
    expect(state.turn).toBe(61);
  });

  it("should not let a seat research the same technology twice over a long game", () => {
    const state = createSimState({ seats, seed: 11, game: "sim" });
    for (let turn = 0; turn < 80; turn += 1) {
      if (!state.seats.korea.currentResearch) {
        const next = researchOptions(state.seats.korea)[0];
        if (next) state.seats.korea.currentResearch = next;
      }
      advanceTurn(state, defaultSimConfig);
    }

    expect(new Set(state.seats.korea.techs).size).toBe(state.seats.korea.techs.length);
    expect(state.seats.korea.techs.length).toBeGreaterThan(3);
  });

  it("should refuse a technology the seat already knows", () => {
    const state = createSimState({ seats, seed: 11, game: "sim" });
    state.seats.korea.techs.push("Pottery");

    const applied = applyCommit(state, "korea", [{ type: "research", technology: "Pottery" }]);

    expect(applied.join(" ")).toContain("already known");
    expect(state.seats.korea.currentResearch).toBeNull();
  });

  it("should apply a seat's research choice and report it", () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });

    const applied = applyCommit(state, "korea", [{ type: "research", technology: "Pottery" }]);

    expect(state.seats.korea.currentResearch).toBe("Pottery");
    expect(applied.join(" ")).toContain("Research set to Pottery");
  });

  it("should refuse a policy that is not available yet", () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });

    const applied = applyCommit(state, "korea", [{ type: "policy", policy: "Tradition Tradition Opener" }]);

    expect(state.seats.korea.policies).toEqual([]);
    expect(applied.join(" ")).toContain("Policy refused");
  });

  it("should record a posture toward another seat", () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });

    applyCommit(state, "korea", [{ type: "posture", target: 1, public: 3, private: -2 }]);

    expect(state.seats.korea.relationships.austria.publicValue).toBe(3);
    expect(state.seats.korea.relationships.austria.privateValue).toBe(-2);
  });

  it("should turn an injected betrayal into news both seats can see", () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });

    const applied = applyShocks(state, [{ turn: 1, kind: "betrayal", seat: "austria", target: "korea" }]);

    expect(applied).toHaveLength(1);
    expect(state.events.map((event) => event.detail).join(" ")).toContain("broke their word");
    expect(state.events.filter((event) => event.kind === "betrayal")).toHaveLength(2);
    expect(state.seats.austria.relationships.korea.privateValue).toBeLessThan(0);
  });

  it("should make an injected military surge change what rivals can see", () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });
    const before = state.seats.siam.militaryStrength;

    applyShocks(state, [{ turn: 1, kind: "military-surge", seat: "siam", magnitude: 2 }]);

    expect(state.seats.siam.militaryStrength).toBeGreaterThan(before);
  });

  it("should declare war and peace between two seats", () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });

    applyShocks(state, [{ turn: 1, kind: "war", seat: "iroquois", target: "siam" }]);
    expect(state.seats.iroquois.relationships.siam.atWar).toBe(true);
    expect(state.seats.siam.relationships.iroquois.atWar).toBe(true);

    applyShocks(state, [{ turn: 1, kind: "peace", seat: "iroquois", target: "siam" }]);
    expect(state.seats.iroquois.relationships.siam.atWar).toBe(false);
  });

  it("should render an observation with the sections a seat expects", async () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });
    const world = new SimulatedWorld({ state, socialDirectory: directory });
    await world.beginTurn("korea", 1);

    const observation = world.observation("korea", 1);

    for (const section of [
      "TURN 1 (simulated game sim)",
      "You are Sejong, leader of Korea",
      "Current:",
      "Since your previous opportunity to act:",
      "What happened to your last committed actions:",
      "Politics since your last opportunity",
      "Messages for you",
      "Groups for you",
      "Deal thread",
      "commit your actions (commit_turn) or pass"
    ]) {
      expect(observation).toContain(section);
    }
  });

  it("should show a seat the messages other seats sent it", async () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });
    const world = new SimulatedWorld({ state, socialDirectory: directory });
    await applyOperations(directory, "austria", [{ kind: "world", message: "Friends, a proposal." }], { seats });
    await applyOperations(directory, "siam", [{ kind: "dm", to: "korea", message: "Only for you." }], { seats });

    await world.beginTurn("korea", 1);
    const observation = world.observation("korea", 1);

    expect(observation).toContain("Friends, a proposal.");
    expect(observation).toContain("Only for you.");
    await world.beginTurn("iroquois", 1);
    const other = world.observation("iroquois", 1);

    expect(other).toContain("Friends, a proposal.");
    expect(other).not.toContain("Only for you.");
  });

  it("should answer inspect from the generated state instead of from a recording", async () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });
    state.seats.korea.gold = 137;
    const world = new SimulatedWorld({ state, socialDirectory: directory });

    const answer = await world.inspect("korea", 1, "self");
    const deals = await world.inspect("korea", 1, "deals");

    expect(answer.text).toContain("137");
    expect(answer.gap).toBeUndefined();
    expect(deals.gap).toBe(true);
  });

  it("should carry a committed action into the world and the next observation", async () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });
    const world = new SimulatedWorld({ state, socialDirectory: directory });
    await world.beginTurn("korea", 1);

    world.commit("korea", [{ type: "research", technology: "Pottery" }]);
    await world.beginTurn("korea", 2);
    const observation = world.observation("korea", 2);

    expect(state.seats.korea.currentResearch).toBe("Pottery");
    expect(observation).toContain("Research set to Pottery");
  });
});
