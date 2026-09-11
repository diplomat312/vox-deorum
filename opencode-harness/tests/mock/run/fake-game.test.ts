// Covers the stand-in game a live run can be pointed at, which is what lets the
// live path be played without Civilization V installed.
//
// The last case drives it over the real protocol on a real socket, because the
// transport is where the live path's own bugs have hidden.

import { afterEach, describe, expect, it } from "vitest";
import { FakeGame, readFakeSeats, serveFakeGame, type RunningFakeGame } from "../../../src/run/fake-game.js";
import { requiredVoxTools } from "../../../src/run/live.js";
import { HttpVoxConnector } from "../../../src/world/live/vox-connector.js";

// The four seats the bench's runs use, as the command line names them.
const bench = [
  { seat: "korea", playerID: 0, civ: "Korea", leader: "Sejong" },
  { seat: "austria", playerID: 1, civ: "Austria", leader: "Maria Theresa" },
  { seat: "siam", playerID: 2, civ: "Siam", leader: "Ramkhamhaeng" },
  { seat: "iroquois", playerID: 3, civ: "Iroquois", leader: "Hiawatha" }
];

// A game that advances a turn every four seconds, as a run sees one.
function game(overrides: Partial<{ turnMs: number }> = {}): FakeGame {
  return new FakeGame({ seats: bench, turnMs: overrides.turnMs ?? 4000 });
}

let running: RunningFakeGame | null = null;

afterEach(async () => {
  if (running) await running.close();
  running = null;
});

describe("the stand-in game", () => {
  it("should offer every tool a live run requires", async () => {
    const held = game();
    const missing: string[] = [];
    for (const name of requiredVoxTools) {
      const answer = await held.call(name, { PlayerID: 0 });
      if (answer.includes("does not offer")) missing.push(name);
    }

    // A stand-in missing a required tool would fail a run at preflight, which
    // is the one thing it exists to avoid.
    expect(missing).toEqual([]);
  });

  it("should answer a seat's own read with the state it holds", async () => {
    const held = game();

    const players = JSON.parse(await held.call("get-players", { PlayerID: 0 })) as { Players: Array<{ Civ: string }> };
    const cities = JSON.parse(await held.call("get-cities", { PlayerID: 0 })) as { Cities: Array<{ Name: string }> };

    expect(players.Players).toHaveLength(4);
    expect(cities.Cities[0].Name).toBe("Seoul");
  });

  it("should refuse an action it cannot take in the shape the game uses", async () => {
    const held = game();

    const answer = await held.call("set-research", { PlayerID: 0, Technology: "Philosophy" });

    // A refusal is a successful call whose payload says no, which is the shape
    // that is easy to mistake for an action that was taken.
    expect(JSON.parse(answer)).toMatchObject({ Success: false, Error: { Code: "INVALID_TECHNOLOGY" } });
  });

  it("should record what a seat wrote and let the other side read it", async () => {
    const held = game();
    const proposal = JSON.parse(await held.call("append-message", {
      PlayerAID: 0,
      PlayerBID: 1,
      SpeakerID: 0,
      MessageType: "deal-proposal",
      Content: "peace",
      Payload: { Deal: { version: 1, items: [{ fromPlayerID: 0, toPlayerID: 1, itemType: "GOLD", amount: 20 }], promises: [] } }
    })) as { ID: number };

    const read = JSON.parse(await held.call("read-transcript", { PlayerAID: 1, PlayerBID: 0 })) as {
      messages: Array<{ ID: number; MessageType: string }>;
    };

    // One conversation per pair, read the same way whichever end asks.
    expect(read.messages).toEqual([expect.objectContaining({ ID: proposal.ID, MessageType: "deal-proposal" })]);
  });

  it("should enact a deal once and refuse a second enactment", async () => {
    const held = game();
    const proposal = JSON.parse(await held.call("append-message", {
      PlayerAID: 0,
      PlayerBID: 1,
      SpeakerID: 0,
      MessageType: "deal-proposal",
      Payload: { Deal: { version: 1, items: [{ fromPlayerID: 0, toPlayerID: 1, itemType: "GOLD", amount: 20 }], promises: [] } }
    })) as { ID: number };
    const before = JSON.parse(await held.call("get-players", { PlayerID: 1 })) as { Players: Array<{ Gold: number }> };

    const enacted = await held.call("enact-agent-deal", { ProposalMessageID: proposal.ID, AccepterID: 1 });

    expect(JSON.parse(enacted)).toMatchObject({ Success: true, Enacted: true });
    // A deal costs something when it is enacted, which is what makes the round
    // trip worth testing rather than only the shape of the answer.
    const after = JSON.parse(await held.call("get-players", { PlayerID: 1 })) as { Players: Array<{ Gold: number }> };
    expect(after.Players[1].Gold).toBe(before.Players[1].Gold + 20);
    expect(JSON.parse(await held.call("enact-agent-deal", { ProposalMessageID: proposal.ID, AccepterID: 1 }))).toMatchObject({
      Success: false,
      Error: { Code: "NOT_OPEN" }
    });
  });

  it("should hold its clock while paused and let it run again", async () => {
    const held = game({ turnMs: 40 });
    await held.call("pause-game", { PlayerID: 0 });
    const before = Number(await held.call("get-metadata", { Key: "turn" }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    const frozen = Number(await held.call("get-metadata", { Key: "turn" }));
    await held.call("resume-game", { PlayerID: 0 });
    await new Promise((resolve) => setTimeout(resolve, 120));
    const moved = Number(await held.call("get-metadata", { Key: "turn" }));

    // A clock that did not move on its own would make every pacing test vacuous.
    expect(frozen).toBe(before);
    expect(moved).toBeGreaterThan(frozen);
  });

  it("should read a table from the command line and skip what it cannot read", () => {
    expect(readFakeSeats("korea:0:Korea:Sejong,austria:1:Austria:Maria Theresa")[0]).toEqual({
      seat: "korea",
      playerID: 0,
      civ: "Korea",
      leader: "Sejong"
    });
    expect(readFakeSeats("korea:0,nonsense,:2,austria")).toHaveLength(1);
  });
});

describe("the stand-in game over the wire", () => {
  it("should serve its tools to a real MCP client on a real socket", async () => {
    // Port zero so the test never collides with a stand-in already running.
    running = await serveFakeGame(game(), 0);
    const connector = new HttpVoxConnector(running.url);
    await connector.connect();

    const tools = await connector.listTools();
    const answer = await connector.call("get-players", { PlayerID: 0 });

    expect(tools).toContain("set-research");
    expect(JSON.parse(answer.text)).toHaveProperty("Players");
    await connector.close();
  });

  it("should keep answering after a request it cannot make sense of", async () => {
    running = await serveFakeGame(game(), 0);
    const junk = await fetch(running.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json"
    });

    // A failure in one request must not take the table down with it, which is
    // what an unguarded handler did the first time this was written.
    expect([400, 406, 500]).toContain(junk.status);
    const healthy = await fetch(running.url.replace("/mcp", "/health"));
    expect(healthy.status).toBe(200);
  });
});
