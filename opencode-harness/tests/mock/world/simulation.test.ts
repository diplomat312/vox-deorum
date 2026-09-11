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

  it("should empty a treasury so a promised payment can genuinely fail", () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });
    state.seats.austria.gold = 180;

    const applied = applyShocks(state, [{ turn: 1, kind: "bankruptcy", seat: "austria" }]);

    expect(state.seats.austria.gold).toBe(0);
    expect(applied.join(" ")).toContain("drained 180 gold");
    expect(state.events.some((event) => event.kind === "bankruptcy")).toBe(true);
  });

  it("should cost a seat standing when it fails to pay what it promised", () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });
    state.seats.austria.gold = 0;
    state.seats.korea.gold = 50;
    state.transfers.push({ deal: "e-1", from: "austria", to: "korea", goldPerTurn: 10, remaining: 5 });

    advanceTurn(state, defaultSimConfig);

    // Only Korea knows it was not paid, so its private regard falls and its
    // public regard does not. This is how a reputation forms from conduct
    // rather than only from what a seat says about itself.
    expect(state.seats.korea.relationships.austria.privateValue).toBeLessThan(0);
    expect(state.seats.korea.relationships.austria.publicValue).toBe(0);
    expect(state.events.some((event) => event.detail.includes("was not paid"))).toBe(true);
  });

  it("should end a tribute the payer can no longer meet", () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });
    state.seats.austria.gold = 0;
    state.transfers.push({ deal: "e-1", from: "austria", to: "korea", goldPerTurn: 10, remaining: 5 });

    // A turn passes with an empty treasury, so the promised payment fails and
    // the promise ends rather than going into debt.
    advanceTurn(state, defaultSimConfig);

    expect(state.transfers).toHaveLength(0);
    expect(state.events.some((event) => event.kind === "deal" && event.detail.includes("missed payment"))).toBe(true);
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

  it("should carry a council from its founding through membership to private business", async () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });
    const world = new SimulatedWorld({ state, socialDirectory: directory });

    // Austria founds a council and invites the table.
    const created = await applyOperations(
      directory,
      "austria",
      [
        { kind: "group-create", name: "Four Courts Council" },
        { kind: "invite", group: "e-1", to: "korea" },
        { kind: "invite", group: "e-1", to: "siam" }
      ],
      { seats }
    );
    const groupId = created[0].id;

    // The founder sees who has been asked.
    await world.beginTurn("austria", 1);
    expect(world.observation("austria", 1)).toContain("Four Courts Council");
    expect(world.observation("austria", 1)).toContain("invited: korea, siam");

    // The invitee sees the council and is given the id an accept has to name.
    await world.beginTurn("korea", 1);
    const inviteeView = world.observation("korea", 1);
    expect(inviteeView).toContain("Four Courts Council");
    expect(inviteeView).toContain("invited");
    expect(inviteeView).toContain("id " + groupId);

    // A seat that was never invited is not told the council exists.
    await world.beginTurn("iroquois", 1);
    expect(world.observation("iroquois", 1)).toContain("Member of no groups.");

    // Korea accepts, and only then does the council become a place to talk.
    await applyOperations(directory, "korea", [{ kind: "accept", group: groupId }], { seats });
    await applyOperations(
      directory,
      "austria",
      [{ kind: "group-msg", group: groupId, message: "Let us speak freely here." }],
      { seats }
    );
    await world.beginTurn("korea", 2);
    const member = world.observation("korea", 2);
    await world.beginTurn("siam", 2);
    const invitedOnly = world.observation("siam", 2);

    expect(member).toContain("Let us speak freely here.");
    expect(member).toContain("member");
    // Siam was invited but never accepted, so the council business is not its
    // to read. This is the privacy rule the feature exists for.
    expect(invitedOnly).not.toContain("Let us speak freely here.");
  });

  it("should show a seat the invitation it has been sent, and keep showing it", async () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });
    const world = new SimulatedWorld({ state, socialDirectory: directory });
    await applyOperations(directory, "austria", [{ kind: "group-create", name: "Four Courts Council" }], { seats });
    // The group id is the id of the entry that created it.
    const { readVisible } = await import("../../../src/social/social-store.js");
    const groupId = (await readVisible(directory, "austria")).find((entry) => entry.kind === "group-create")?.id ?? "";
    await applyOperations(directory, "austria", [{ kind: "invite", group: groupId, to: "korea" }], { seats });

    await world.beginTurn("korea", 1);
    const first = world.observation("korea", 1);
    // Reading the observation again must still show the invitation. A view that
    // consumed the seat's cursor would show it once and then forget it, which
    // is how a seat ends up telling the table that the summons never arrived.
    await world.beginTurn("korea", 2);
    const second = world.observation("korea", 2);

    expect(first).toContain("Four Courts Council");
    expect(first).toContain("invited");
    expect(second).toContain("Four Courts Council");
  });

  it("should answer inspect from the generated state instead of from a recording", async () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });
    state.seats.korea.gold = 137;
    const world = new SimulatedWorld({ state, socialDirectory: directory });

    const answer = await world.inspect("korea", 1, "self");
    const deals = await world.inspect("korea", 1, "deals");

    expect(answer.text).toContain("137");
    expect(answer.gap).toBeUndefined();
    // Deals are a real surface now, so the answer carries the open deals and
    // how to propose one rather than reporting that none exists.
    expect(deals.gap).toBeUndefined();
    expect(deals.text).toContain("HowToTrade");
  });

  it("should carry out the terms of an agreed deal", async () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });
    state.seats.austria.gold = 200;
    state.seats.korea.gold = 0;
    const world = new SimulatedWorld({ state, socialDirectory: directory });

    // Austria offers gold, and Korea accepts. Terms are paid in the world.
    const proposed = await applyOperations(directory, "austria", [
      { kind: "deal-propose", to: "korea", gold: 50, goldPerTurn: 5, message: "For our friendship." }
    ], { seats });
    const dealId = proposed[0].id;
    await applyOperations(directory, "korea", [{ kind: "deal-accept", deal: dealId }], { seats });

    await world.beginTurn("korea", 1);

    expect(state.seats.austria.gold).toBe(150);
    expect(state.seats.korea.gold).toBe(50);
    expect(state.transfers).toHaveLength(1);
    expect(state.events.some((event) => event.kind === "deal")).toBe(true);
  });

  it("should show a seat the offer it has been sent and who owes it tribute", async () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });
    state.seats.austria.gold = 200;
    const world = new SimulatedWorld({ state, socialDirectory: directory });

    const proposed = await applyOperations(directory, "austria", [
      { kind: "deal-propose", to: "korea", gold: 20, message: "A token of goodwill." }
    ], { seats });
    const dealId = proposed[0].id;

    await world.beginTurn("korea", 1);
    const observation = world.observation("korea", 1);
    const detail = await world.inspect("korea", 1, "deals");

    // The seat is told the id to answer and what answering buys.
    expect(observation).toContain("deal " + dealId);
    expect(observation).toContain("20 gold");
    expect(detail.text).toContain(dealId);

    // The proposer sees its own offer waiting, and can pay it.
    await world.beginTurn("austria", 1);
    expect(world.observation("austria", 1)).toContain("waiting on them");
  });

  it("should settle an agreed deal once and only once", async () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });
    state.seats.austria.gold = 200;
    const world = new SimulatedWorld({ state, socialDirectory: directory });
    const proposed = await applyOperations(directory, "austria", [
      { kind: "deal-propose", to: "korea", gold: 50 }
    ], { seats });
    await applyOperations(directory, "korea", [{ kind: "deal-accept", deal: proposed[0].id }], { seats });

    await world.beginTurn("korea", 1);
    const afterFirst = state.seats.korea.gold;
    // Playing later turns must not pay the same promise again.
    await world.beginTurn("korea", 2);
    await world.beginTurn("korea", 3);

    expect(afterFirst).toBe(50);
    expect(state.seats.korea.gold).toBeGreaterThanOrEqual(50);
    expect(state.settledDeals).toHaveLength(1);
  });

  it("should not invite a policy that cannot be adopted yet", async () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });
    const world = new SimulatedWorld({ state, socialDirectory: directory });
    await world.beginTurn("korea", 1);

    const observation = world.observation("korea", 1);

    // Asking for a policy while saying the next arrives in fifty turns invited an
    // action the world refused, and a seat that took the invitation lost the turn's
    // action to a silent no-op.
    expect(observation).toContain("No policy can be adopted yet");
    expect(observation).not.toContain("Policy must name ONE exact entry");
  });

  it("should invite a policy once one is ready", async () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });
    state.seats.korea.policyAvailable = true;
    const world = new SimulatedWorld({ state, socialDirectory: directory });
    await world.beginTurn("korea", 1);

    const observation = world.observation("korea", 1);

    expect(observation).toContain("A policy is ready now");
    expect(observation).toContain("Tradition Tradition Opener");
  });

  it("should let a policy be adopted inside a normal run", () => {
    // A mechanic that cannot be used in any run is not being tested. At the
    // original cost the first policy arrived on turn forty-three, past the end of
    // every run played, so the policy tree went unexercised across every result.
    const state = createSimState({ seats, seed: 5, game: "sim" });
    let firstReady: number | null = null;
    for (let turn = 1; turn <= 20; turn += 1) {
      if (state.seats.korea.policyAvailable && firstReady === null) firstReady = turn;
      advanceTurn(state, defaultSimConfig);
    }

    expect(firstReady).not.toBeNull();
    expect(firstReady as number).toBeLessThanOrEqual(15);
  });

  it("should adopt a policy a seat asks for once one is ready", () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });
    state.seats.korea.policyAvailable = true;

    const applied = applyCommit(state, "korea", [{ type: "policy", policy: "Tradition Tradition Opener" }]);

    expect(state.seats.korea.policies).toContain("Tradition Tradition Opener");
    expect(state.seats.korea.policyAvailable).toBe(false);
    expect(applied.join(" ")).toContain("Adopted Tradition Tradition Opener");
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

  it("should leave the diplomacy standing out of the observation by default", async () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });
    const world = new SimulatedWorld({ state, socialDirectory: directory });
    await world.beginTurn("korea", 1);

    expect(world.observation("korea", 1)).not.toContain("Diplomacy standing");
  });

  it("should name the state of contact when the diplomacy standing is on", async () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });
    const world = new SimulatedWorld({ state, socialDirectory: directory, diplomacyBriefing: true });
    await applyOperations(directory, "austria", [{ kind: "world", message: "Greetings from Vienna." }], { seats });
    await applyOperations(directory, "korea", [{ kind: "dm", to: "siam", message: "A private word." }], { seats });

    await world.beginTurn("korea", 1);
    const observation = world.observation("korea", 1);

    // The section states what a private message is, because a seat that does
    // not know it is private has no reason to send one.
    expect(observation).toContain("Diplomacy standing");
    expect(observation).toContain("a direct message goes only to that one seat");
    // Austria has been heard from, and Korea's own private word to Siam is
    // reflected back so it can see that it has opened a channel.
    expect(observation).toContain("Austria: last said: Greetings from Vienna.");
    expect(observation).toContain("Siam: has not been in touch; you have sent them 1 private message(s)");
    expect(observation).toContain("Iroquois: has not been in touch");
  });

  it("should name the grand strategy only when asked to", async () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });
    const plain = new SimulatedWorld({ state, socialDirectory: directory, diplomacyCoaching: true });
    const named = new SimulatedWorld({
      state: createSimState({ seats, seed: 5, game: "sim" }),
      socialDirectory: directory,
      diplomacyCoaching: true,
      strategyCoaching: true
    });
    await plain.beginTurn("korea", 1);
    await named.beginTurn("korea", 1);

    // Two strategy actions were committed in nearly two thousand seat turns, so
    // the question is whether naming the declaration is the same lever that
    // worked for posture.
    expect(plain.observation("korea", 1)).not.toContain("A strategy action is how you declare");
    expect(named.observation("korea", 1)).toContain("A strategy action is how you declare what you are about");
    expect(named.observation("korea", 1)).toContain("assume the worst");
  });

  it("should name posture and councils only when asked to", async () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });
    const plain = new SimulatedWorld({ state, socialDirectory: directory, diplomacyCoaching: true });
    const named = new SimulatedWorld({
      state: createSimState({ seats, seed: 5, game: "sim" }),
      socialDirectory: directory,
      diplomacyCoaching: true,
      postureCoaching: true,
      councilCoaching: true
    });
    await plain.beginTurn("korea", 1);
    await named.beginTurn("korea", 1);

    // Posture and councils are separate from coaching on purpose: a seat that
    // talks without acting is the gap this closes, and mixing it into the
    // coaching line would make the two effects impossible to tell apart.
    expect(plain.observation("korea", 1)).not.toContain("A posture action is how the game records");
    const observation = named.observation("korea", 1);
    expect(observation).toContain("A posture action is how the game records how you regard another seat");
    expect(observation).toContain("A council is a private room for part of the table");
  });

  it("should close with the plain instruction unless coaching is on", async () => {
    const state = createSimState({ seats, seed: 5, game: "sim" });
    const plain = new SimulatedWorld({ state, socialDirectory: directory });
    const coached = new SimulatedWorld({
      state: createSimState({ seats, seed: 5, game: "sim" }),
      socialDirectory: directory,
      diplomacyCoaching: true
    });
    await plain.beginTurn("korea", 1);
    await coached.beginTurn("korea", 1);

    expect(plain.observation("korea", 1)).not.toContain("decide who needs to hear from you");
    const observation = coached.observation("korea", 1);
    // The coached closing states what talking does rather than asking the seat
    // to be talkative, so the seat keeps the decision.
    expect(observation).toContain("decide who needs to hear from you this turn");
    expect(observation).toContain("A direct message reaches one seat and no one else");
    expect(observation).toContain("Saying nothing is a decision like any other");
  });
});
