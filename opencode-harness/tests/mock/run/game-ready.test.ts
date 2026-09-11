// Covers the live run's readiness check: that a game which answers a read
// passes, and a game which refuses one is reported before the run starts.

import { describe, expect, it } from "vitest";
import { checkGameReady } from "../../../src/run/live.js";

describe("checking that the game is ready", () => {
  it("should pass when the game answers a read", async () => {
    const connector = { call: async () => ({ text: '{"Score":174}', isError: false }) };

    expect(await checkGameReady(connector, 0)).toBeNull();
  });

  it("should report a game that has no state loaded", async () => {
    // This is the answer the real server gives before a game is loaded, and it
    // is the reason a run is refused rather than starting into empty briefings.
    const connector = {
      call: async () => ({
        text: "Error executing tool get-players: KnowledgeStore not initialized. Call loadKnowledge() first.",
        isError: true
      })
    };

    const problem = await checkGameReady(connector, 0);

    expect(problem).toContain("not ready to be played");
    expect(problem).toContain("KnowledgeStore not initialized");
    expect(problem).toContain("game already loaded");
  });

  it("should report a call that could not be made at all", async () => {
    const connector = {
      call: async () => {
        throw new Error("connect ECONNREFUSED");
      }
    };

    expect(await checkGameReady(connector, 0)).toContain("ECONNREFUSED");
  });

  it("should check nothing when there is no seat to read", async () => {
    let called = false;
    const connector = {
      call: async () => {
        called = true;
        return { text: "", isError: false };
      }
    };

    expect(await checkGameReady(connector, null)).toBeNull();
    expect(called).toBe(false);
  });
});

