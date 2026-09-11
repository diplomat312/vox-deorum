// What the world itself recorded by the end of a run.
//
// The trace says what the seats said and did, and the social log says who spoke
// to whom. Neither says what the game made of it. The world snapshot holds the
// part that outlived the conversation: which deals were settled, which promises
// are still being paid, which were broken, who is at war, and how the seats
// actually regard each other once everything has been said.
//
// This is the reading a roundup needs for its twists, and the reading that shows
// whether a table that talked left anything behind.

import { readFile } from "node:fs/promises";
import path from "node:path";

// A regard held by one seat toward another.
export interface RegardEntry {
  // The seat that holds the opinion.
  from: string;
  // The seat it is about.
  to: string;
  // What the world records publicly.
  publicValue: number;
  // What the seat actually thinks.
  privateValue: number;
  // Whether the two are at war.
  atWar: boolean;
}

// What the world recorded by the end of a run.
export interface WorldSummary {
  // The turn the snapshot was taken on.
  turn: number;
  // Deals that were agreed and carried out.
  settledDeals: number;
  // Promises still being paid, each with the turns left.
  tributeInForce: Array<{ from: string; to: string; goldPerTurn: number; turnsLeft: number }>;
  // Promises that were not kept.
  brokenPromises: number;
  // Wars that were declared at any point.
  wars: Array<{ turn: number; detail: string }>;
  // Every regard held, so distrust can be read off rather than inferred.
  regards: RegardEntry[];
  // The pair with the coldest private regard, when any seat distrusts another.
  coldest: RegardEntry | null;
}

// Read the world snapshot a run left behind, or null when it wrote none.
export async function readWorldSummary(runDirectory: string): Promise<WorldSummary | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path.join(runDirectory, "state", "world.json"), "utf8"));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") return null;
  const world = parsed as {
    turn?: unknown;
    order?: unknown;
    seats?: unknown;
    settledDeals?: unknown;
    transfers?: unknown;
    events?: unknown;
  };
  const order = Array.isArray(world.order) ? (world.order as string[]) : [];
  const seats = (world.seats ?? {}) as Record<string, { relationships?: Record<string, { publicValue?: number; privateValue?: number; atWar?: boolean }> }>;
  const regards: RegardEntry[] = [];
  for (const from of order) {
    const relationships = seats[from]?.relationships ?? {};
    for (const [to, relation] of Object.entries(relationships)) {
      regards.push({
        from,
        to,
        publicValue: typeof relation?.publicValue === "number" ? relation.publicValue : 0,
        privateValue: typeof relation?.privateValue === "number" ? relation.privateValue : 0,
        atWar: relation?.atWar === true
      });
    }
  }
  const events = Array.isArray(world.events)
    ? (world.events as Array<{ turn?: unknown; kind?: unknown; detail?: unknown }>)
    : [];
  const wars = events
    .filter((event) => event.kind === "war" && typeof event.detail === "string")
    .map((event) => ({ turn: typeof event.turn === "number" ? event.turn : 0, detail: String(event.detail) }));
  const brokenPromises = events.filter(
    (event) => typeof event.detail === "string" && event.detail.includes("was not paid")
  ).length;
  const transfers = Array.isArray(world.transfers)
    ? (world.transfers as Array<{ from?: unknown; to?: unknown; goldPerTurn?: unknown; remaining?: unknown }>)
    : [];
  const coldest = regards.length === 0
    ? null
    : regards.reduce((worst, entry) => (entry.privateValue < worst.privateValue ? entry : worst));
  return {
    turn: typeof world.turn === "number" ? world.turn : 0,
    settledDeals: Array.isArray(world.settledDeals) ? world.settledDeals.length : 0,
    tributeInForce: transfers.map((transfer) => ({
      from: String(transfer.from),
      to: String(transfer.to),
      goldPerTurn: typeof transfer.goldPerTurn === "number" ? transfer.goldPerTurn : 0,
      turnsLeft: typeof transfer.remaining === "number" ? transfer.remaining : 0
    })),
    brokenPromises,
    wars,
    regards,
    coldest: coldest && coldest.privateValue < 0 ? coldest : null
  };
}
