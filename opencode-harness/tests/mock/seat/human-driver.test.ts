// Covers a person playing a seat: the briefing they are offered, the decision
// they give, and the turn that comes back from it.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HumanSeatDriver,
  answerFileName,
  decisionFileName,
  decisionToToolCalls,
  pendingFileName,
  requestFileName
} from "../../../src/seat/human-driver.js";

describe("turning a person's decision into tool calls", () => {
  it("should read a commit as the seat committing actions", () => {
    const calls = decisionToToolCalls({
      kind: "commit",
      rationale: "Pottery for the granary",
      actions: [{ type: "research", technology: "Pottery" }]
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].tool).toBe("vox-civ_commit_turn");
    expect(calls[0].input).toEqual({
      rationale: "Pottery for the granary",
      actions: [{ type: "research", technology: "Pottery" }]
    });
  });

  it("should read a pass as the seat doing nothing", () => {
    const calls = decisionToToolCalls({ kind: "pass", rationale: "quiet turn" });

    expect(calls).toHaveLength(1);
    expect(calls[0].tool).toBe("vox-civ_pass");
  });

  it("should carry what the person said to the table alongside the decision", () => {
    const calls = decisionToToolCalls({
      kind: "pass",
      operations: [{ kind: "world", message: "Friends, a proposal." }]
    });

    // The message comes before the pass, because it is what the person did
    // before deciding, and the pass ends the turn.
    expect(calls.map((call) => call.tool)).toEqual(["vox-civ_communicate", "vox-civ_pass"]);
    expect(calls[0].input).toEqual({ operations: [{ kind: "world", message: "Friends, a proposal." }] });
  });

  it("should commit an empty list rather than inventing an action", () => {
    const calls = decisionToToolCalls({ kind: "commit", rationale: "nothing to change" });

    expect(calls[0].input).toEqual({ rationale: "nothing to change", actions: [] });
  });
});

describe("a person playing a seat", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "harness-human-"));
  });

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("should offer the turn and hand back what the person decided", async () => {
    const driver = new HumanSeatDriver({ seat: "korea", directory, pollMs: 10, timeoutMs: 5000 });
    const offering = driver.sendObservation("korea", "TURN 4 (simulated game sim)", 4);

    // A person reads the briefing, then answers it.
    await new Promise((resolve) => setTimeout(resolve, 60));
    const pending = JSON.parse(await readFile(path.join(directory, pendingFileName), "utf8"));
    expect(pending.turn).toBe(4);
    expect(pending.observation).toContain("TURN 4");
    expect(pending.howToAnswer).toContain(decisionFileName);

    await writeFile(
      path.join(directory, decisionFileName),
      JSON.stringify({ kind: "commit", rationale: "Seoul grows first", actions: [{ type: "research", technology: "Pottery" }] }),
      "utf8"
    );

    const result = await offering;

    expect(result.session).toBe("human:korea");
    expect(result.model).toBe("human");
    // For a person the rationale is the thinking, so it is kept as reasoning.
    expect(result.reasoning).toBe("Seoul grows first");
    expect(result.toolCalls[0].tool).toBe("vox-civ_commit_turn");
    // A person spends no tokens, and the trace says so honestly.
    expect(result.usage.total).toBe(0);
    expect(result.usage.cost).toBeNull();
  });

  it("should ignore a decision left over from an earlier turn", async () => {
    await writeFile(
      path.join(directory, decisionFileName),
      JSON.stringify({ kind: "commit", rationale: "stale", actions: [] }),
      "utf8"
    );
    const driver = new HumanSeatDriver({ seat: "korea", directory, pollMs: 10, timeoutMs: 3000 });
    const offering = driver.sendObservation("korea", "TURN 9", 9);

    await new Promise((resolve) => setTimeout(resolve, 60));
    await writeFile(path.join(directory, decisionFileName), JSON.stringify({ kind: "pass", rationale: "this turn" }), "utf8");
    const result = await offering;

    expect(result.reasoning).toBe("this turn");
  });

  it("should answer a lookup the person asks for", async () => {
    const driver = new HumanSeatDriver({
      seat: "korea",
      directory,
      pollMs: 10,
      timeoutMs: 5000,
      answerInspect: async (request) => "the answer about " + request.subject
    });
    const offering = driver.sendObservation("korea", "TURN 2", 2);

    await new Promise((resolve) => setTimeout(resolve, 60));
    await writeFile(path.join(directory, requestFileName), JSON.stringify({ subject: "cities" }), "utf8");
    await new Promise((resolve) => setTimeout(resolve, 120));

    const answer = await readFile(path.join(directory, answerFileName), "utf8");
    expect(answer).toContain("the answer about cities");

    await writeFile(path.join(directory, decisionFileName), JSON.stringify({ kind: "pass" }), "utf8");
    await expect(offering).resolves.toBeDefined();
  });

  it("should give up rather than wait forever", async () => {
    const driver = new HumanSeatDriver({ seat: "korea", directory, pollMs: 10, timeoutMs: 120 });

    await expect(driver.sendObservation("korea", "TURN 1", 1)).rejects.toThrowError(/did not decide on turn 1/);
  });

  it("should refuse a turn meant for another seat", async () => {
    const driver = new HumanSeatDriver({ seat: "korea", directory, pollMs: 10, timeoutMs: 500 });

    await expect(driver.sendObservation("siam", "TURN 1", 1)).rejects.toThrowError(/was asked for 'siam'/);
  });

  it("should say so when a lookup cannot be answered", async () => {
    const driver = new HumanSeatDriver({ seat: "korea", directory, pollMs: 10, timeoutMs: 3000 });
    const offering = driver.sendObservation("korea", "TURN 5", 5);

    await new Promise((resolve) => setTimeout(resolve, 60));
    await writeFile(path.join(directory, requestFileName), JSON.stringify({ subject: "deals" }), "utf8");
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(await readFile(path.join(directory, answerFileName), "utf8")).toContain("cannot answer");
    await writeFile(path.join(directory, decisionFileName), JSON.stringify({ kind: "pass" }), "utf8");
    await offering;
  });
});

