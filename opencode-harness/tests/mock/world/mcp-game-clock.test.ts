// Covers the game clock as reached through the MCP tools, including the one
// question the tools do not answer directly: whether the game is really holding.

import { describe, expect, it } from "vitest";
import { McpGameClock } from "../../../src/world/live/mcp-game-clock.js";
import type { VoxConnector, VoxToolResult } from "../../../src/world/live/vox-connector.js";

// A connection that answers from a table and counts what it was asked.
class FakeConnector implements VoxConnector {
  // Every call made.
  readonly calls: Array<{ name: string; args: Record<string, unknown> }> = [];

  constructor(private readonly answers: Record<string, string>) {}

  async call(name: string, args: Record<string, unknown> = {}): Promise<VoxToolResult> {
    this.calls.push({ name, args });
    const text = this.answers[name];
    if (text === undefined) return { text: "no such tool", isError: true };
    return { text, isError: false };
  }

  async listTools(): Promise<string[]> {
    return Object.keys(this.answers);
  }

  async close(): Promise<void> {
    return;
  }
}

describe("the game clock over the MCP tools", () => {
  it("should hold and release the game with the game's own actions", async () => {
    const connector = new FakeConnector({ "pause-game": "true", "resume-game": "true" });
    const clock = new McpGameClock(connector, 3);

    expect(await clock.pause()).toBe(true);
    expect(await clock.resume()).toBe(true);
    // Both are attributed to the seat that asked, which is what the game needs.
    expect(connector.calls[0]).toEqual({ name: "pause-game", args: { PlayerID: 3 } });
    expect(connector.calls[1]).toEqual({ name: "resume-game", args: { PlayerID: 3 } });
  });

  it("should read a refusal to hold as a refusal", async () => {
    const connector = new FakeConnector({ "pause-game": "false", "resume-game": "true" });
    const clock = new McpGameClock(connector, 0, 1);

    expect(await clock.pause()).toBe(false);
  });

  it("should read a tool that failed as a refusal rather than as success", async () => {
    const connector = new FakeConnector({});
    const clock = new McpGameClock(connector, 0, 1);

    expect(await clock.pause()).toBe(false);
    expect(await clock.resume()).toBe(false);
  });

  it("should read the turn from the store's own metadata", async () => {
    const connector = new FakeConnector({ "get-metadata": "42" });
    const clock = new McpGameClock(connector, 0, 1);

    expect(await clock.turn()).toBe(42);
    expect(connector.calls[0]).toEqual({ name: "get-metadata", args: { Key: "turn" } });
  });

  it("should refuse a turn that the game did not answer with a number", async () => {
    const connector = new FakeConnector({ "get-metadata": "" });
    const clock = new McpGameClock(connector, 0, 1);

    // An empty answer must be refused rather than read as zero, because zero is
    // a valid turn and two unreadable reads would then look like a held game.
    await expect(clock.turn()).rejects.toThrowError(/no turn at all/);
  });

  it("should refuse a turn that is not a number even when it is not empty", async () => {
    const connector = new FakeConnector({ "get-metadata": "unknown" });
    const clock = new McpGameClock(connector, 0, 1);

    await expect(clock.turn()).rejects.toThrowError(/not a number/);
  });

  it("should confirm a game that did not move as held", async () => {
    const connector = new FakeConnector({ "get-metadata": "17" });
    const clock = new McpGameClock(connector, 0, 1);

    expect(await clock.isFrozen()).toBe(true);
    // It confirms by asking twice, because no tool answers the question directly.
    expect(connector.calls.filter((call) => call.name === "get-metadata")).toHaveLength(2);
  });

  it("should refuse to call a game that advanced a held game", async () => {
    // The recorded game produced exactly this: a pause accepted while the game
    // carried on, so a hold has to be confirmed rather than assumed.
    let turnReads = 0;
    const connector: VoxConnector = {
      async call(name: string): Promise<VoxToolResult> {
        if (name !== "get-metadata") return { text: "true", isError: false };
        turnReads += 1;
        return { text: String(17 + turnReads - 1), isError: false };
      },
      async listTools() {
        return ["get-metadata"];
      },
      async close() {
        return;
      }
    };
    const clock = new McpGameClock(connector, 0, 1);

    expect(await clock.isFrozen()).toBe(false);
  });

  it("should not call an unreadable game held", async () => {
    // Treating an unknown as held would be the unsafe direction, because the
    // whole point of holding is to trust the state a decision was made from.
    const connector = new FakeConnector({});
    const clock = new McpGameClock(connector, 0, 1);

    expect(await clock.isFrozen()).toBe(false);
  });
});
