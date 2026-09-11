// Covers the append-only social store: what each seat may see, how a cursor
// keeps a seat from replaying, and which bad input is refused.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  acceptedDeals,
  applyOperations,
  getCursor,
  openDealsForSeat,
  readCorrespondence,
  readInbox,
  readVisible,
  setCursor,
  storePaths
} from "../../../src/social/social-store.js";
import type { InboxPage, Operation } from "../../../src/social/social-store.js";

// The roster every test plays with.
const seats = ["korea", "siam", "austria"];

// The run directory each test works in, created fresh so nothing leaks between.
let runDir: string;

beforeEach(async () => {
  runDir = await mkdtemp(join(tmpdir(), "social-store-"));
});

afterEach(async () => {
  await rm(runDir, { recursive: true, force: true });
});

// The message bodies in a page, ignoring control entries that carry no text.
function bodies(page: InboxPage): string[] {
  return page.messages.filter((entry) => typeof entry.text === "string").map((entry) => entry.text as string);
}

// Open a group as korea and invite one seat, returning the group id.
async function openInvitedGroup(invitee: string): Promise<string> {
  const created = await applyOperations(runDir, "korea", [{ kind: "group-create", name: "War Council" }], { seats });
  const group = created[0].id;
  await applyOperations(runDir, "korea", [{ kind: "invite", group, to: invitee }], { seats });
  return group;
}

describe("social store", () => {
  it("should show a world message to every seat", async () => {
    await applyOperations(runDir, "korea", [{ kind: "world", message: "greetings" }], { seats });

    expect(bodies(await readInbox(runDir, "korea"))).toEqual(["greetings"]);
    expect(bodies(await readInbox(runDir, "siam"))).toEqual(["greetings"]);
    expect(bodies(await readInbox(runDir, "austria"))).toEqual(["greetings"]);
  });

  it("should show a direct message only to its two seats", async () => {
    await applyOperations(runDir, "korea", [{ kind: "dm", to: "siam", message: "keep this quiet" }], { seats });

    expect(bodies(await readInbox(runDir, "korea"))).toEqual(["keep this quiet"]);
    expect(bodies(await readInbox(runDir, "siam"))).toEqual(["keep this quiet"]);
    expect(bodies(await readInbox(runDir, "austria"))).toEqual([]);
  });

  it("should hold a group message until the invitee accepts", async () => {
    const group = await openInvitedGroup("siam");
    await applyOperations(runDir, "korea", [{ kind: "group-msg", group, message: "join us" }], { seats });

    const pending = await readInbox(runDir, "siam");
    expect(pending.messages.some((entry) => entry.kind === "group-msg")).toBe(false);
    expect(pending.messages.some((entry) => entry.kind === "invite")).toBe(true);

    await applyOperations(runDir, "siam", [{ kind: "accept", group }], { seats });
    const accepted = await readInbox(runDir, "siam");
    expect(accepted.messages.some((entry) => entry.kind === "group-msg" && entry.text === "join us")).toBe(true);

    expect((await readInbox(runDir, "austria")).messages.some((entry) => entry.kind === "group-msg")).toBe(false);
  });

  it("should not let an invitation alone deliver group messages", async () => {
    const group = await openInvitedGroup("siam");

    await expect(
      applyOperations(runDir, "siam", [{ kind: "group-msg", group, message: "hello" }], { seats })
    ).rejects.toThrowError(/siam is not a member of group/);
  });

  it("should not replay messages a seat already read", async () => {
    await applyOperations(runDir, "korea", [{ kind: "world", message: "one" }], { seats });
    await applyOperations(runDir, "korea", [{ kind: "world", message: "two" }], { seats });

    expect(bodies(await readInbox(runDir, "siam"))).toEqual(["one", "two"]);
    expect(bodies(await readInbox(runDir, "siam"))).toEqual([]);

    await applyOperations(runDir, "korea", [{ kind: "world", message: "three" }], { seats });
    expect(bodies(await readInbox(runDir, "siam"))).toEqual(["three"]);
  });

  it("should keep an independent cursor for each seat", async () => {
    await applyOperations(runDir, "korea", [{ kind: "world", message: "hello" }], { seats });

    expect(await getCursor(runDir, "siam")).toBe(0);
    await readInbox(runDir, "siam");
    expect(await getCursor(runDir, "siam")).toBe(1);
    expect(await getCursor(runDir, "austria")).toBe(0);

    expect(bodies(await readInbox(runDir, "austria"))).toEqual(["hello"]);
  });

  it("should persist a cursor a caller sets", async () => {
    await applyOperations(runDir, "korea", [{ kind: "world", message: "hello" }], { seats });
    await applyOperations(runDir, "korea", [{ kind: "world", message: "again" }], { seats });

    await setCursor(runDir, "austria", 2);
    expect(await getCursor(runDir, "austria")).toBe(2);
    expect(bodies(await readInbox(runDir, "austria"))).toEqual([]);

    const stored = JSON.parse(await readFile(storePaths(runDir).cursors, "utf8"));
    expect(stored).toMatchObject({ austria: 2 });
  });

  it("should refuse a batch larger than the limit without writing", async () => {
    const tooMany: Operation[] = Array.from({ length: 9 }, () => ({ kind: "world", message: "spam" }));

    await expect(applyOperations(runDir, "korea", tooMany, { seats })).rejects.toThrowError(/at most 8 operations/);
    expect(bodies(await readInbox(runDir, "siam"))).toEqual([]);
  });

  it("should refuse an empty batch and an unknown kind", async () => {
    await expect(applyOperations(runDir, "korea", [], { seats })).rejects.toThrowError(/non-empty array/);
    await expect(
      applyOperations(runDir, "korea", [{ kind: "shout", message: "hi" } as unknown as Operation], { seats })
    ).rejects.toThrowError(/unknown operation kind: shout/);
  });

  it("should refuse operations with a missing field", async () => {
    await expect(applyOperations(runDir, "korea", [{ kind: "world" }], { seats })).rejects.toThrowError(
      /world operation needs message/
    );
    await expect(
      applyOperations(runDir, "korea", [{ kind: "dm", message: "hi" }], { seats })
    ).rejects.toThrowError(/dm operation needs to/);
    await expect(applyOperations(runDir, "korea", [{ kind: "group-create" }], { seats })).rejects.toThrowError(
      /group-create operation needs name/
    );
  });

  it("should refuse a direct message to a seat that does not exist", async () => {
    await expect(
      applyOperations(runDir, "korea", [{ kind: "dm", to: "ghost", message: "hello" }], { seats })
    ).rejects.toThrowError(/dm target 'ghost' is not a seat in this run/);
  });

  it("should refuse an accept for a group that was never created", async () => {
    await expect(
      applyOperations(runDir, "siam", [{ kind: "accept", group: "e-99" }], { seats })
    ).rejects.toThrowError(/unknown group 'e-99'/);
  });

  it("should refuse an accept with no invitation", async () => {
    const created = await applyOperations(runDir, "korea", [{ kind: "group-create", name: "Quiet Room" }], { seats });

    await expect(
      applyOperations(runDir, "siam", [{ kind: "accept", group: created[0].id }], { seats })
    ).rejects.toThrowError(/no invitation for siam to group/);
  });

  it("should refuse leaving a group the seat is not in", async () => {
    const created = await applyOperations(runDir, "korea", [{ kind: "group-create", name: "War Council" }], { seats });

    await expect(
      applyOperations(runDir, "austria", [{ kind: "leave", group: created[0].id }], { seats })
    ).rejects.toThrowError(/austria is not a member of group/);
  });

  it("should refuse an invite from a seat outside the group", async () => {
    const created = await applyOperations(runDir, "korea", [{ kind: "group-create", name: "War Council" }], { seats });

    await expect(
      applyOperations(runDir, "austria", [{ kind: "invite", group: created[0].id, to: "siam" }], { seats })
    ).rejects.toThrowError(/only members may invite/);
  });

  it("should refuse a group message to a group that was never created", async () => {
    await expect(
      applyOperations(runDir, "korea", [{ kind: "group-msg", group: "e-99", message: "hi" }], { seats })
    ).rejects.toThrowError(/unknown group 'e-99'/);
  });

  it("should refuse a batch whole once one operation is bad", async () => {
    await expect(
      applyOperations(
        runDir,
        "korea",
        [
          { kind: "world", message: "fine" },
          { kind: "dm", to: "ghost", message: "not fine" }
        ],
        { seats }
      )
    ).rejects.toThrowError(/not a seat in this run/);
    expect(bodies(await readInbox(runDir, "siam"))).toEqual([]);
  });

  it("should read a correspondence in both directions only", async () => {
    await applyOperations(runDir, "korea", [{ kind: "dm", to: "siam", message: "hello siam" }], { seats });
    await applyOperations(runDir, "siam", [{ kind: "dm", to: "korea", message: "hello korea" }], { seats });
    await applyOperations(runDir, "korea", [{ kind: "dm", to: "austria", message: "elsewhere" }], { seats });
    await applyOperations(runDir, "korea", [{ kind: "world", message: "public" }], { seats });

    const thread = await readCorrespondence(runDir, "korea", "siam");
    expect(thread.map((entry) => entry.text)).toEqual(["hello siam", "hello korea"]);
    expect(thread.map((entry) => entry.from)).toEqual(["korea", "siam"]);
    expect(thread.every((entry) => entry.kind === "dm")).toBe(true);

    const mirrored = await readCorrespondence(runDir, "siam", "korea");
    expect(mirrored.map((entry) => entry.id)).toEqual(thread.map((entry) => entry.id));
  });

  it("should carry a stable id, timestamp, sender and kind on every entry", async () => {
    const applied = await applyOperations(runDir, "korea", [{ kind: "world", message: "greetings" }], { seats });

    expect(applied[0].id).toBe("e-1");
    expect(applied[0].from).toBe("korea");
    expect(applied[0].kind).toBe("world");
    expect(Number.isNaN(Date.parse(applied[0].at))).toBe(false);
  });

  it("should replay the same ids for the same operations in a fresh run", async () => {
    const operations: Operation[] = [
      { kind: "world", message: "hello" },
      { kind: "group-create", name: "War Council" },
      { kind: "invite", group: "e-2", to: "siam" }
    ];
    const other = await mkdtemp(join(tmpdir(), "social-store-replay-"));
    try {
      const first = await applyOperations(runDir, "korea", operations, { seats });
      const second = await applyOperations(other, "korea", operations, { seats });

      expect(first.map((entry) => entry.id)).toEqual(["e-1", "e-2", "e-3"]);
      expect(second.map((entry) => entry.id)).toEqual(first.map((entry) => entry.id));
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });
});

// Covers negotiated deals: who may propose, who may answer, and what a world
// reads back once a deal is settled.
describe("negotiated deals", () => {
  it("should show a deal proposal to both parties and to no one else", async () => {
    const applied = await applyOperations(
      runDir,
      "korea",
      [{ kind: "deal-propose", to: "siam", gold: 100, message: "peace for gold" }],
      { seats }
    );

    expect(applied[0]).toMatchObject({
      id: "e-1",
      from: "korea",
      kind: "deal-propose",
      to: "siam",
      gold: 100,
      text: "peace for gold"
    });
    expect((await readVisible(runDir, "korea")).filter((entry) => entry.kind === "deal-propose")).toHaveLength(1);
    expect((await readVisible(runDir, "siam")).filter((entry) => entry.kind === "deal-propose")).toHaveLength(1);
    expect(await readVisible(runDir, "austria")).toEqual([]);
  });

  it("should refuse a deal a seat proposes to itself", async () => {
    await expect(
      applyOperations(runDir, "korea", [{ kind: "deal-propose", to: "korea", gold: 1 }], { seats })
    ).rejects.toThrowError(/cannot propose a deal to yourself/);
  });

  it("should refuse a deal proposal with no terms", async () => {
    await expect(
      applyOperations(runDir, "korea", [{ kind: "deal-propose", to: "siam" }], { seats })
    ).rejects.toThrowError(/at least one term/);
    await expect(
      applyOperations(runDir, "korea", [{ kind: "deal-propose", to: "siam", resource: "  " }], { seats })
    ).rejects.toThrowError(/at least one term/);
  });

  it("should refuse a negative or fractional gold amount", async () => {
    await expect(
      applyOperations(runDir, "korea", [{ kind: "deal-propose", to: "siam", gold: -5 }], { seats })
    ).rejects.toThrowError(/positive whole number for gold/);
    await expect(
      applyOperations(runDir, "korea", [{ kind: "deal-propose", to: "siam", gold: 2.5 }], { seats })
    ).rejects.toThrowError(/positive whole number for gold/);
    await expect(
      applyOperations(runDir, "korea", [{ kind: "deal-propose", to: "siam", goldPerTurn: 0 }], { seats })
    ).rejects.toThrowError(/positive whole number for goldPerTurn/);
  });

  it("should let the recipient accept a deal and refuse the proposer", async () => {
    const proposed = await applyOperations(
      runDir,
      "korea",
      [{ kind: "deal-propose", to: "siam", gold: 50, goldPerTurn: 2 }],
      { seats }
    );
    const deal = proposed[0].id;

    await expect(
      applyOperations(runDir, "korea", [{ kind: "deal-accept", deal }], { seats })
    ).rejects.toThrowError(/cannot answer their own deal/);

    const accepted = await applyOperations(runDir, "siam", [{ kind: "deal-accept", deal }], { seats });
    expect(accepted[0]).toMatchObject({ id: "e-2", kind: "deal-accept", from: "siam", to: "korea", deal });
    expect((await readVisible(runDir, "korea")).some((entry) => entry.kind === "deal-accept")).toBe(true);
    expect((await readVisible(runDir, "siam")).some((entry) => entry.kind === "deal-accept")).toBe(true);
    expect((await readVisible(runDir, "austria")).some((entry) => entry.kind === "deal-accept")).toBe(false);
  });

  it("should let the recipient reject a deal", async () => {
    const proposed = await applyOperations(
      runDir,
      "korea",
      [{ kind: "deal-propose", to: "siam", goldPerTurn: 5 }],
      { seats }
    );

    const rejected = await applyOperations(runDir, "siam", [{ kind: "deal-reject", deal: proposed[0].id }], { seats });
    expect(rejected[0]).toMatchObject({
      id: "e-2",
      kind: "deal-reject",
      from: "siam",
      to: "korea",
      deal: proposed[0].id
    });
    expect((await readVisible(runDir, "korea")).some((entry) => entry.kind === "deal-reject")).toBe(true);
    expect((await readVisible(runDir, "austria")).some((entry) => entry.kind === "deal-reject")).toBe(false);
  });

  it("should refuse a second answer to the same deal", async () => {
    const proposed = await applyOperations(runDir, "korea", [{ kind: "deal-propose", to: "siam", gold: 1 }], {
      seats
    });
    await applyOperations(runDir, "siam", [{ kind: "deal-accept", deal: proposed[0].id }], { seats });

    await expect(
      applyOperations(runDir, "siam", [{ kind: "deal-reject", deal: proposed[0].id }], { seats })
    ).rejects.toThrowError(/has already been answered/);
  });

  it("should refuse an answer for an unknown deal or from a stranger", async () => {
    await expect(
      applyOperations(runDir, "siam", [{ kind: "deal-accept", deal: "e-99" }], { seats })
    ).rejects.toThrowError(/unknown deal 'e-99'/);
    await expect(
      applyOperations(runDir, "siam", [{ kind: "deal-reject", deal: "e-99" }], { seats })
    ).rejects.toThrowError(/unknown deal 'e-99'/);

    const proposed = await applyOperations(runDir, "korea", [{ kind: "deal-propose", to: "siam", gold: 1 }], {
      seats
    });
    await expect(
      applyOperations(runDir, "austria", [{ kind: "deal-accept", deal: proposed[0].id }], { seats })
    ).rejects.toThrowError(/is not addressed to austria/);
  });

  it("should list an open deal for both parties until it is answered", async () => {
    const proposed = await applyOperations(runDir, "korea", [{ kind: "deal-propose", to: "siam", gold: 30 }], {
      seats
    });
    await applyOperations(runDir, "korea", [{ kind: "deal-propose", to: "austria", resource: "iron" }], { seats });

    expect(await openDealsForSeat(runDir, "korea")).toEqual([
      { id: proposed[0].id, from: "korea", to: "siam", gold: 30 },
      { id: "e-2", from: "korea", to: "austria", resource: "iron" }
    ]);
    expect(await openDealsForSeat(runDir, "siam")).toEqual([
      { id: proposed[0].id, from: "korea", to: "siam", gold: 30 }
    ]);
    expect(await openDealsForSeat(runDir, "austria")).toEqual([
      { id: "e-2", from: "korea", to: "austria", resource: "iron" }
    ]);

    await applyOperations(runDir, "siam", [{ kind: "deal-reject", deal: proposed[0].id }], { seats });
    expect(await openDealsForSeat(runDir, "korea")).toEqual([
      { id: "e-2", from: "korea", to: "austria", resource: "iron" }
    ]);
    expect(await openDealsForSeat(runDir, "siam")).toEqual([]);
  });

  it("should report an accepted deal with its terms and who accepted", async () => {
    const deals = await applyOperations(
      runDir,
      "korea",
      [
        { kind: "deal-propose", to: "siam", gold: 40, resource: "silk", message: "take it" },
        { kind: "deal-propose", to: "austria", goldPerTurn: 3 }
      ],
      { seats }
    );
    await applyOperations(runDir, "siam", [{ kind: "deal-accept", deal: deals[0].id }], { seats });

    expect(await acceptedDeals(runDir)).toEqual([
      {
        id: deals[0].id,
        from: "korea",
        to: "siam",
        gold: 40,
        resource: "silk",
        text: "take it",
        acceptedBy: "siam"
      }
    ]);
  });

  it("should leave the log unchanged when a deal operation in a batch is refused", async () => {
    await expect(
      applyOperations(
        runDir,
        "korea",
        [
          { kind: "world", message: "fine" },
          { kind: "deal-propose", to: "siam" }
        ],
        { seats }
      )
    ).rejects.toThrowError(/at least one term/);

    expect(await readVisible(runDir, "korea")).toEqual([]);
    expect(await openDealsForSeat(runDir, "siam")).toEqual([]);
    expect(bodies(await readInbox(runDir, "siam"))).toEqual([]);
  });
});
