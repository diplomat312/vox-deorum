// Covers the live world against a fake connection.
//
// Nothing here opens a socket or a game. The fake answers the same calls the
// real server answers, which is what lets the live path be written and checked
// without launching Civilization V.

import { describe, expect, it } from "vitest";
import { LiveWorld, inspectCalls, readCalls, writeCall } from "../../../src/world/live/live-world.js";
import type { VoxConnector, VoxToolResult } from "../../../src/world/live/vox-connector.js";

// A connection that answers from a table and records what it was asked.
class FakeConnector implements VoxConnector {
  // Every call made, so a test can prove the reads and writes a turn produced.
  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  // Answers keyed by tool name.
  constructor(private readonly answers: Record<string, string>, private readonly failing: string[] = []) {}

  async call(name: string, args: Record<string, unknown> = {}): Promise<VoxToolResult> {
    this.calls.push({ name, args });
    if (this.failing.includes(name)) return { text: "the game refused", isError: true };
    const text = this.answers[name] ?? "{}";
    return { text, isError: false };
  }

  async listTools(): Promise<string[]> {
    return Object.keys(this.answers);
  }

  async close(): Promise<void> {
    return;
  }

  // The tools called so far, in order.
  names(): string[] {
    return this.calls.map((call) => call.name);
  }
}

// The answers a live server would give for one seat at the table.
const answers: Record<string, string> = {
  "get-players": '{"Score":174,"Gold":120,"Happiness":"Happy"}',
  "get-cities": '{"Seoul":{"Population":4}}',
  "get-military-report": '{"Units":6,"Strength":52}',
  "get-options": '{"Technology":"Writing","Policy":"Tradition Opener"}',
  "get-victory-progress": '{"ScienceVictory":{"Progress":12}}',
  "get-opinions": '{"Austria":{"Public":1,"Private":-3}}',
  "get-events": '{"12":[{"Type":"PlayerDoTurn"}]}',
  "get-diplomatic-events": '{"11":["Austria denounced Korea"]}',
  "inspect-deal": '{"items":[],"promises":[]}',
  "set-research": '{"Success":true,"Previous":"Pottery"}',
  "set-relationship": '{"Success":true,"Target":"Austria"}',
  "keep-status-quo": '{"Success":true}'
};

describe("reading a real game", () => {
  it("should fetch every section of the observation and render them in order", async () => {
    const connector = new FakeConnector(answers);
    const world = new LiveWorld({
      connector,
      seats: [
        { seat: "korea", playerID: 0 },
        { seat: "austria", playerID: 1 }
      ],
      game: "live-1",
      names: { korea: { civ: "Korea", leader: "Sejong" }, austria: { civ: "Austria", leader: "Maria Theresa" } }
    });

    await world.beginTurn("korea", 12);
    const observation = world.observation("korea", 12);

    expect(observation).toContain("TURN 12 (live game live-1)");
    expect(observation).toContain("You are Sejong, leader of Korea (seat 0)");
    expect(observation).toContain("Austria (seat 1)");
    // Each section carries the real answer rather than a placeholder.
    expect(observation).toContain("174");
    expect(observation).toContain("Seoul");
    expect(observation).toContain("Writing");
    expect(observation).toContain("denounced");
    // The reads a turn makes, one per section.
    expect(connector.names()).toContain("get-players");
    expect(connector.names()).toContain("get-options");
    expect(connector.names()).toContain("get-diplomatic-events");
    // Every read is addressed by the seat's player index.
    for (const call of connector.calls) {
      expect(call.args.PlayerID).toBe(0);
    }
  });

  it("should still render a turn when a read fails, saying so rather than stopping", async () => {
    const connector = new FakeConnector(answers, ["get-military-report"]);
    const world = new LiveWorld({ connector, seats: [{ seat: "korea", playerID: 0 }] });

    await world.beginTurn("korea", 3);

    // A read that failed is a fact the seat can act on, not a reason to lose
    // the turn, so the observation still carries every other section.
    expect(world.observation("korea", 3)).toContain("Military: could not be read");
    expect(world.observation("korea", 3)).toContain("Writing");
  });

  it("should refuse to render a turn that was never prepared", () => {
    const world = new LiveWorld({ connector: new FakeConnector(answers), seats: [{ seat: "korea", playerID: 0 }] });

    expect(() => world.observation("korea", 5)).toThrowError(/no prepared observation/);
  });

  it("should refuse a seat that is not at this table", async () => {
    const world = new LiveWorld({ connector: new FakeConnector(answers), seats: [{ seat: "korea", playerID: 0 }] });

    await expect(world.beginTurn("siam", 1)).rejects.toThrowError(/No seat named 'siam'/);
  });
});

describe("answering an inspect", () => {
  it("should answer from what the turn already read rather than reading twice", async () => {
    const connector = new FakeConnector(answers);
    const world = new LiveWorld({ connector, seats: [{ seat: "korea", playerID: 0 }] });
    await world.beginTurn("korea", 4);
    const before = connector.calls.length;

    const answer = await world.inspect("korea", 4, "cities");

    expect(answer.text).toContain("Seoul");
    expect(connector.calls.length).toBe(before);
  });

  it("should read a subject the turn did not fetch", async () => {
    const connector = new FakeConnector(answers);
    const world = new LiveWorld({ connector, seats: [{ seat: "korea", playerID: 0 }] });
    await world.beginTurn("korea", 4);

    const answer = await world.inspect("korea", 4, "deals", "1");

    expect(connector.names()).toContain("inspect-deal");
    expect(answer.text).toContain("items");
  });

  it("should say plainly when a subject has no live reading", async () => {
    const world = new LiveWorld({ connector: new FakeConnector(answers), seats: [{ seat: "korea", playerID: 0 }] });

    const answer = await world.inspect("korea", 1, "deals");

    expect(answer.gap).toBe(true);
    expect(answer.text).toContain("no reading in a live game");
  });
});

describe("sending a decision to the game", () => {
  it("should translate each action into the tool that owns it", () => {
    expect(writeCall(0, { type: "research", technology: "Writing", rationale: "science" })).toEqual({
      tool: "set-research",
      args: { PlayerID: 0, Technology: "Writing", Rationale: "science" }
    });
    expect(writeCall(0, { type: "posture", target: 1, public: 2, private: -3, rationale: "wary" })).toEqual({
      tool: "set-relationship",
      args: { PlayerID: 0, TargetID: 1, Rationale: "wary", Public: 2, Private: -3 }
    });
    expect(writeCall(0, { type: "strategy", grand: "Science", economic: ["Growth"], rationale: "plan" })).toEqual({
      tool: "set-strategy",
      args: { PlayerID: 0, Rationale: "plan", GrandStrategy: "Science", EconomicStrategies: ["Growth"] }
    });
    expect(writeCall(0, { type: "keep_status_quo", rationale: "quiet" })).toEqual({
      tool: "keep-status-quo",
      args: { PlayerID: 0, Rationale: "quiet" }
    });
  });

  it("should refuse an action it cannot express rather than dropping it silently", () => {
    // A posture with no target cannot be sent, and returning nothing is how the
    // caller learns to report it.
    expect(writeCall(0, { type: "posture", rationale: "vague" })).toBeNull();
    expect(writeCall(0, { type: "conquest", rationale: "ambitious" })).toBeNull();
    expect(writeCall(0, { type: "research", rationale: "no technology named" })).toBeNull();
  });

  it("should send every committed action to the game", async () => {
    const connector = new FakeConnector(answers);
    const world = new LiveWorld({ connector, seats: [{ seat: "korea", playerID: 0 }] });

    await world.applyDecision("korea", [
      { type: "research", technology: "Writing", rationale: "science" },
      { type: "posture", target: 1, private: -2, rationale: "wary" }
    ]);

    expect(connector.names()).toEqual(["set-research", "set-relationship"]);
  });

  it("should survive the game refusing an action", async () => {
    const connector = new FakeConnector(answers, ["set-research"]);
    const world = new LiveWorld({ connector, seats: [{ seat: "korea", playerID: 0 }] });

    // A refusal is the game's answer, not a crash: the run carries on.
    await expect(
      world.applyDecision("korea", [{ type: "research", technology: "Writing", rationale: "science" }])
    ).resolves.toBeUndefined();
  });

  it("should name the reads a turn makes and the reads an inspect makes", () => {
    const reads = readCalls(7);

    expect(Object.keys(reads)).toHaveLength(8);
    expect(reads.self.args.PlayerID).toBe(7);
    expect(inspectCalls(7, "cities")[0].tool).toBe("get-cities");
    expect(inspectCalls(7, "deals", "2")[0].args).toEqual({ PlayerAID: 7, PlayerBID: 2 });
    expect(inspectCalls(7, "deals")).toEqual([]);
    expect(inspectCalls(7, "nonsense")).toEqual([]);
  });
});
