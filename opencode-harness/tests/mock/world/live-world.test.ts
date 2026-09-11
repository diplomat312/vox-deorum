// Covers the live world against a fake connection.
//
// Nothing here opens a socket or a game. The fake answers the same calls the
// real server answers, which is what lets the live path be written and checked
// without launching Civilization V.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { LiveWorld, inspectCalls, readCalls, refusedByGame, writeCall } from "../../../src/world/live/live-world.js";
import type { VoxConnector, VoxToolResult } from "../../../src/world/live/vox-connector.js";
import { applyOperations } from "../../../src/social/social-store.js";

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
    // The deal thread is read from the game's transcript, and a pair read names
    // both endpoints, so it is the one call that carries no single player index.
    expect(observation).toContain("Deal thread, read from the game's own transcript");
    expect(observation).toContain("- Nothing on the table.");
    // Every other read is addressed by the seat's player index.
    for (const call of connector.calls) {
      if (call.name === "read-transcript") continue;
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

describe("telling a refusal from a success", () => {
  it("should read an error-marked call as a refusal", () => {
    expect(refusedByGame({ text: "the tool failed", isError: true })).toBe(true);
  });

  it("should read a successful call with a false Success flag as a refusal", () => {
    // This is the shape the real server returns when the game will not take an
    // action. It is a successful call carrying a refusal, so reading only the
    // error flag would log a rejected action as applied.
    const refusal = {
      text: JSON.stringify({
        Success: false,
        Error: { Code: "FUNCTION_NOT_FOUND", Message: "Function 'default-func-set-research' is not available" }
      }),
      isError: false
    };

    expect(refusedByGame(refusal)).toBe(true);
  });

  it("should read a successful call with a true Success flag as taken", () => {
    expect(refusedByGame({ text: JSON.stringify({ Success: true, Previous: "Pottery" }), isError: false })).toBe(false);
  });

  it("should treat a body that says nothing about success as taken", () => {
    // A plain boolean, a bare string or malformed text carries no refusal.
    expect(refusedByGame({ text: "true", isError: false })).toBe(false);
    expect(refusedByGame({ text: "not json at all", isError: false })).toBe(false);
    expect(refusedByGame({ text: "{}", isError: false })).toBe(false);
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

    // A refusal is the game's answer, not a crash: the run carries on, and the
    // record says the action was not taken rather than reporting it as applied.
    const outcomes = await world.applyDecision("korea", [
      { type: "research", technology: "Writing", rationale: "science" }
    ]);

    expect(outcomes).toEqual([{ type: "research", taken: false, reason: "the game refused" }]);
  });

  it("should report a refusal the game wraps in a successful call", async () => {
    // The shape the real server returns for an action the game will not take.
    const connector = new FakeConnector({
      "set-research": JSON.stringify({
        Success: false,
        Error: { Code: "FUNCTION_NOT_FOUND", Message: "Function 'default-func-set-research' is not available" }
      })
    });
    const world = new LiveWorld({ connector, seats: [{ seat: "korea", playerID: 0 }] });

    const outcomes = await world.applyDecision("korea", [
      { type: "research", technology: "Writing", rationale: "science" }
    ]);

    expect(outcomes[0].taken).toBe(false);
    expect(outcomes[0].reason).toContain("not available");
  });

  it("should report an action it never sent, rather than dropping it", async () => {
    const connector = new FakeConnector(answers);
    const world = new LiveWorld({ connector, seats: [{ seat: "korea", playerID: 0 }] });

    const outcomes = await world.applyDecision("korea", [{ type: "conquest", rationale: "ambitious" }]);

    expect(outcomes[0].taken).toBe(false);
    expect(outcomes[0].reason).toContain("no live equivalent");
    expect(connector.calls).toHaveLength(0);
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

// A proposal written between korea and austria, as the game stores it.
function proposalRow(id: number, speakerID: number, turn: number): string {
  return JSON.stringify({
    ID: id,
    Player1ID: 0,
    Player2ID: 1,
    Player1Role: "",
    Player2Role: "",
    SpeakerID: speakerID,
    MessageType: "deal-proposal",
    Content: "",
    Payload: {
      Deal: {
        version: 1,
        items: [{ fromPlayerID: speakerID, toPlayerID: speakerID === 1 ? 0 : 1, itemType: "GOLD", amount: 50 }],
        promises: []
      }
    },
    Turn: turn,
    CreatedAt: 1
  });
}

// An answer row, which is how the game records that a proposal was closed.
function answerRow(id: number, proposalID: number, messageType: string): string {
  return JSON.stringify({
    ID: id,
    Player1ID: 0,
    Player2ID: 1,
    Player1Role: "",
    Player2Role: "",
    SpeakerID: 1,
    MessageType: messageType,
    Content: "",
    Payload: { ProposalMessageID: proposalID },
    Turn: 12,
    CreatedAt: 2
  });
}

// The two seats a deal test needs, with korea as the seat being read.
const pair = [
  { seat: "korea", playerID: 0 },
  { seat: "austria", playerID: 1 }
];

describe("settling a deal in the game's own system", () => {
  it("should show an offer another seat made, read from the game's transcript", async () => {
    const connector = new FakeConnector({
      ...answers,
      "read-transcript": JSON.stringify({ messages: [JSON.parse(proposalRow(41, 1, 12))] })
    });
    const world = new LiveWorld({ connector, seats: pair });

    await world.beginTurn("korea", 12);

    // The offer is read where the game wrote it, and it names the id the seat
    // has to quote back, so a seat never has to guess what it is answering.
    expect(world.observation("korea", 12)).toContain("[turn 12] austria offers offer 41: austria pays 50 gold to korea");
    expect(world.observation("korea", 12)).toContain("answer with deal-accept or deal-reject naming 41");
  });

  it("should stop showing an offer once the game says it was answered", async () => {
    const connector = new FakeConnector({
      ...answers,
      "read-transcript": JSON.stringify({
        messages: [JSON.parse(proposalRow(41, 1, 12)), JSON.parse(answerRow(42, 41, "deal-enacted"))]
      })
    });
    const world = new LiveWorld({ connector, seats: pair });

    await world.beginTurn("korea", 13);

    // A settled offer is not something the seat still has to answer.
    expect(world.observation("korea", 13)).toContain("- Nothing on the table.");
  });

  it("should say what became of an offer this seat made", async () => {
    const connector = new FakeConnector({
      ...answers,
      "read-transcript": JSON.stringify({
        messages: [JSON.parse(proposalRow(51, 0, 12)), JSON.parse(answerRow(52, 51, "deal-accept"))]
      })
    });
    const world = new LiveWorld({ connector, seats: pair });

    await world.beginTurn("korea", 13);

    expect(world.observation("korea", 13)).toContain("Your offer 51 to austria was deal-accept");
  });

  it("should send an offer to the game's deal system and report the proposal id", async () => {
    const connector = new FakeConnector({ ...answers, "append-message": '{"ID":77,"MessageType":"deal-proposal"}' });
    const world = new LiveWorld({ connector, seats: pair });

    const outcome = await world.applyDeal("korea", { kind: "deal-propose", to: "austria", gold: 50, message: "peace" });

    // The id the game returns is what the other seat answers, so a seat is told
    // it rather than left to find it.
    expect(outcome).toEqual({ type: "deal-propose", taken: true, reason: "recorded as proposal 77" });
    expect(connector.calls[0].name).toBe("append-message");
    expect(connector.calls[0].args).toMatchObject({
      PlayerAID: 0,
      PlayerBID: 1,
      MessageType: "deal-proposal"
    });
  });

  it("should enact an accepted offer as one game action", async () => {
    const connector = new FakeConnector({ ...answers, "enact-agent-deal": '{"Success":true,"Enacted":true}' });
    const world = new LiveWorld({ connector, seats: pair });

    const outcome = await world.applyDeal("korea", { kind: "deal-accept", deal: "77" });

    expect(outcome).toEqual({ type: "deal-accept", taken: true });
    expect(connector.calls[0].args).toMatchObject({ ProposalMessageID: 77, AccepterID: 0 });
  });

  it("should refuse a term it cannot express without asking the game", async () => {
    const connector = new FakeConnector(answers);
    const world = new LiveWorld({ connector, seats: pair });

    const outcome = await world.applyDeal("korea", { kind: "deal-propose", to: "austria", resource: "Iron" });

    // A refusal a seat can read beats a malformed deal the game would reject
    // without saying why, so the game is never asked.
    expect(outcome.taken).toBe(false);
    expect(outcome.reason).toContain("resource");
    expect(connector.calls).toHaveLength(0);
  });
});

describe("hearing the other seats in a live game", () => {
  // A game has a place for a deal and none for ordinary diplomacy, so talk is
  // kept in the run's own log. These cover the half that makes the log a
  // conversation: a seat reading back what the others said to it.
  let socialDirectory = "";

  beforeEach(async () => {
    socialDirectory = await mkdtemp(path.join(tmpdir(), "harness-live-social-"));
  });

  afterEach(async () => {
    if (socialDirectory) await rm(socialDirectory, { recursive: true, force: true });
  });

  it("should show what another seat said to this seat", async () => {
    await applyOperations(
      socialDirectory,
      "austria",
      [{ kind: "world", message: "The table should know: Austria means no war." }],
      { seats: ["korea", "austria"] }
    );
    const world = new LiveWorld({ connector: new FakeConnector(answers), seats: pair, socialDirectory });

    await world.beginTurn("korea", 3);

    // The seat hears it in the same shape the generated world uses, so a seat
    // that has played a bench game reads a live one the same way.
    expect(world.observation("korea", 3)).toContain("Messages for you");
    expect(world.observation("korea", 3)).toContain("[public, turn 3] austria: The table should know");
  });

  it("should deliver a private message to the seat it was aimed at and no other", async () => {
    await applyOperations(
      socialDirectory,
      "austria",
      [{ kind: "dm", to: "korea", message: "Offer me a treaty before Siam does." }],
      { seats: ["korea", "austria", "siam"] }
    );
    const world = new LiveWorld({
      connector: new FakeConnector(answers),
      seats: [...pair, { seat: "siam", playerID: 2 }],
      socialDirectory
    });

    await world.beginTurn("siam", 3);

    // Siam is not the addressee, so it hears nothing of it.
    expect(world.observation("siam", 3)).toContain("Messages for you (reply with communicate if warranted");
    expect(world.observation("siam", 3)).toContain("- None.");
    expect(world.observation("siam", 3)).not.toContain("Offer me a treaty");
  });

  it("should not show a message twice", async () => {
    await applyOperations(
      socialDirectory,
      "austria",
      [{ kind: "dm", to: "korea", message: "One time only." }],
      { seats: ["korea", "austria"] }
    );
    const world = new LiveWorld({ connector: new FakeConnector(answers), seats: pair, socialDirectory });

    await world.beginTurn("korea", 3);
    expect(world.observation("korea", 3)).toContain("One time only.");
    // The next turn reads forward from where the seat got to, so a seat is never
    // asked to answer the same message on every turn for the rest of the game.
    await world.beginTurn("korea", 4);
    expect(world.observation("korea", 4)).not.toContain("One time only.");
  });

  it("should show a council invitation with the id needed to accept it", async () => {
    await applyOperations(
      socialDirectory,
      "austria",
      [{ kind: "group-create", name: "Concert of Vienna" }, { kind: "invite", group: "e-1", to: "korea" }],
      { seats: ["korea", "austria"] }
    );
    const world = new LiveWorld({ connector: new FakeConnector(answers), seats: pair, socialDirectory });

    await world.beginTurn("korea", 5);

    // An invitation a seat cannot name is an invitation it cannot answer.
    expect(world.observation("korea", 5)).toContain("Groups for you");
    expect(world.observation("korea", 5)).toContain("Concert of Vienna (id e-1, invited");
  });

  it("should say the world keeps no log when it has no social directory", async () => {
    const world = new LiveWorld({ connector: new FakeConnector(answers), seats: pair });

    await world.beginTurn("korea", 1);

    // "Nothing arrived" and "nobody is listening" are different facts, and a
    // seat should not be told the first when the second is true.
    expect(world.observation("korea", 1)).toContain("None: this world keeps no log of talk");
  });
});
