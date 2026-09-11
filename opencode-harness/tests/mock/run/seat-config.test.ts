// Covers the configuration one seat is written, which is where a run decides
// what its seat may reach: the game's tools, and nothing else.

import { describe, expect, it } from "vitest";
import { seatConfig } from "../../../src/run/seat-config.js";
import { seatAgent, seatToolServer } from "../../../src/session/seat-surface.js";

// The configuration one seat is written, with the game's own address.
function config(): Record<string, unknown> {
  return seatConfig({
    seat: "korea",
    playerID: 0,
    model: { providerID: "opencode-go", modelID: "deepseek-v4.1-flash" },
    seatDirectory: "seat-dir",
    corpusDirectory: "",
    worldStateFile: "state.json",
    socialDirectory: "social",
    serverEntry: "seat-mcp.js",
    identity: "You are the mind of one civilization in a game of Civilization V."
  });
}

describe("a seat's configuration", () => {
  it("should offer the seat its own tools and nothing else", () => {
    const agent = (config().agent as Record<string, { tools: Record<string, boolean> }>)[seatAgent];

    // A project configuration cannot disable an inherited plugin, so the agent
    // is the only thing that closes what the machine has installed.
    expect(agent.tools).toEqual({ "*": false, [seatToolServer + "_*"]: true });
  });

  it("should give the seat its identity as the whole standing context", () => {
    const agent = (config().agent as Record<string, { prompt: string; mode: string }>)[seatAgent];

    // The identity is set once in the configuration rather than sent with each
    // turn, so it is byte identical from turn to turn and the prompt cache holds.
    expect(agent.prompt).toContain("Civilization V");
    expect(agent.mode).toBe("primary");
  });

  it("should switch off the servers a seat must not inherit", () => {
    const mcp = config().mcp as Record<string, { enabled: boolean }>;

    expect(mcp["google-workspace"].enabled).toBe(false);
    expect(mcp[seatToolServer].enabled).toBe(true);
  });

  it("should deny every capability the harness knows by name", () => {
    const permission = config().permission as Record<string, string>;

    for (const name of ["bash", "edit", "write", "read", "glob", "grep", "webfetch", "websearch", "task", "skill"]) {
      expect(permission[name]).toBe("deny");
    }
  });

  it("should make the seat a live one when it is given a live table", () => {
    const mcp = config().mcp as Record<string, { environment: Record<string, string> }>;
    expect(mcp[seatToolServer].environment.PLAYERS).toBe("");

    const live = seatConfig({
      seat: "korea",
      playerID: 0,
      model: { providerID: "opencode-go", modelID: "deepseek-v4.1-flash" },
      seatDirectory: "seat-dir",
      corpusDirectory: "",
      liveSeats: "korea:0,austria:1",
      socialDirectory: "social",
      serverEntry: "seat-mcp.js",
      identity: "You are the mind of one civilization in a game of Civilization V."
    });
    const liveMcp = live.mcp as Record<string, { environment: Record<string, string> }>;

    // A live seat reaches the game rather than a snapshot of it.
    expect(liveMcp[seatToolServer].environment.PLAYERS).toBe("korea:0,austria:1");
  });
});
