// Covers the live run's preflight: that it names the tools a game is missing
// before the first turn rather than after the fortieth.

import { describe, expect, it } from "vitest";
import { preflight, requiredVoxTools } from "../../../src/run/live.js";

describe("checking a game before a live run", () => {
  it("should pass when the game offers every tool the run needs", async () => {
    const connector = { listTools: async () => [...requiredVoxTools, "some-other-tool"] };

    expect(await preflight(connector)).toEqual([]);
  });

  it("should name the tools that are missing", async () => {
    const connector = { listTools: async () => ["get-players", "get-cities"] };

    const missing = await preflight(connector);

    expect(missing).toContain("set-research");
    expect(missing).toContain("get-victory-progress");
    expect(missing).not.toContain("get-players");
  });

  it("should report every tool as missing when nothing answers", async () => {
    const connector = { listTools: async () => [] };

    expect(await preflight(connector)).toEqual(requiredVoxTools);
  });
});
