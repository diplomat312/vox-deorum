// Covers reading what the world recorded: the deals it carried out, the
// promises that were kept or broken, and the regard the seats actually hold.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readWorldSummary } from "../../../src/analysis/world-summary.js";

// A world snapshot, so a test varies only what it checks.
function snapshot(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    turn: 30,
    order: ["korea", "austria"],
    seats: {
      korea: { relationships: { austria: { publicValue: 1, privateValue: -3, atWar: false } } },
      austria: { relationships: { korea: { publicValue: 1, privateValue: 0, atWar: false } } }
    },
    settledDeals: ["e-13"],
    transfers: [{ from: "korea", to: "austria", goldPerTurn: 5, remaining: 4 }],
    events: [
      { turn: 12, kind: "war", detail: "Austria declared war on Korea" },
      { turn: 20, kind: "deal", detail: "Korea was not paid what Austria promised" }
    ],
    ...overrides
  });
}

describe("reading what the world recorded", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "harness-world-"));
  });

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("should report no world when a run left no snapshot", async () => {
    expect(await readWorldSummary(directory)).toBeNull();
  });

  it("should read the deals, the tribute, the war and the broken promise", async () => {
    await mkdir(path.join(directory, "state"), { recursive: true });
    await writeFile(path.join(directory, "state", "world.json"), snapshot(), "utf8");

    const world = await readWorldSummary(directory);

    expect(world?.turn).toBe(30);
    expect(world?.settledDeals).toBe(1);
    expect(world?.tributeInForce).toEqual([{ from: "korea", to: "austria", goldPerTurn: 5, turnsLeft: 4 }]);
    expect(world?.brokenPromises).toBe(1);
    expect(world?.wars).toEqual([{ turn: 12, detail: "Austria declared war on Korea" }]);
  });

  it("should name the coldest regard rather than only counting it", async () => {
    await mkdir(path.join(directory, "state"), { recursive: true });
    await writeFile(path.join(directory, "state", "world.json"), snapshot(), "utf8");

    const world = await readWorldSummary(directory);

    expect(world?.coldest).toEqual({
      from: "korea",
      to: "austria",
      publicValue: 1,
      privateValue: -3,
      atWar: false
    });
  });

  it("should report no cold regard when nobody distrusts anybody", async () => {
    await mkdir(path.join(directory, "state"), { recursive: true });
    await writeFile(
      path.join(directory, "state", "world.json"),
      snapshot({
        seats: {
          korea: { relationships: { austria: { publicValue: 2, privateValue: 2, atWar: false } } },
          austria: { relationships: { korea: { publicValue: 2, privateValue: 2, atWar: false } } }
        },
        events: []
      }),
      "utf8"
    );

    const world = await readWorldSummary(directory);

    expect(world?.coldest).toBeNull();
    expect(world?.wars).toEqual([]);
    expect(world?.brokenPromises).toBe(0);
  });

  it("should survive a snapshot that is missing a field", async () => {
    await mkdir(path.join(directory, "state"), { recursive: true });
    await writeFile(path.join(directory, "state", "world.json"), JSON.stringify({ turn: 3 }), "utf8");

    const world = await readWorldSummary(directory);

    expect(world?.turn).toBe(3);
    expect(world?.settledDeals).toBe(0);
    expect(world?.regards).toEqual([]);
    expect(world?.coldest).toBeNull();
  });
});
