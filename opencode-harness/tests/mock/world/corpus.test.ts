// Covers the corpus loader: ordering, exact preservation of the observation,
// and the strict failures that stop a half-read game.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCorpusDirectory, loadCorpusSeat, parseCorpus } from "../../../src/world/corpus.js";

// Build one valid corpus line, so a test can vary just the field it cares about.
function line(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    game: "test-game",
    seat: "korea",
    playerID: 0,
    turn: 3,
    session: "ses_test",
    observation: "TURN 3 (live game test-game)",
    toolCalls: [],
    modelText: null,
    decision: "commit",
    ...overrides
  });
}

describe("corpus loader", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "harness-corpus-"));
  });

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("should order records by turn and keep the observation byte for byte", () => {
    const text = [
      line({ turn: 5, observation: "TURN 5 observation" }),
      line({ turn: 2, observation: "TURN 2 observation" })
    ].join("\n");

    const turns = parseCorpus(text, "memory.jsonl");

    expect(turns.map((turn) => turn.turn)).toEqual([2, 5]);
    expect(turns[0].observation).toBe("TURN 2 observation");
  });

  it("should keep the seat, session and decision of each record", () => {
    const turns = parseCorpus(line({ decision: "pass" }), "memory.jsonl");

    expect(turns).toHaveLength(1);
    expect(turns[0].seat).toBe("korea");
    expect(turns[0].session).toBe("ses_test");
    expect(turns[0].decision).toBe("pass");
    expect(turns[0].toolCalls).toEqual([]);
  });

  it("should read tool calls without demanding every optional field", () => {
    const text = line({
      toolCalls: [{ tool: "vox-civ_inspect", input: { subject: "self" }, output: "{}" }]
    });

    const turns = parseCorpus(text, "memory.jsonl");

    expect(turns[0].toolCalls).toEqual([
      { tool: "vox-civ_inspect", input: { subject: "self" }, output: "{}", error: null, status: null }
    ]);
  });

  it("should name the source and line when a line is not JSON", () => {
    const text = [line(), "this is not json"].join("\n");

    expect(() => parseCorpus(text, "broken.jsonl")).toThrowError(/broken\.jsonl line 2/);
  });

  it("should refuse a record that has no observation", () => {
    const text = JSON.stringify({ game: "test-game", seat: "korea", turn: 1 });

    expect(() => parseCorpus(text, "broken.jsonl")).toThrowError(/observation/);
  });

  it("should load one seat file by name", async () => {
    await writeFile(path.join(directory, "korea.jsonl"), line() + "\n", "utf8");

    const turns = await loadCorpusSeat(directory, "korea");

    expect(turns).toHaveLength(1);
    expect(turns[0].seat).toBe("korea");
  });

  it("should load a whole directory in sorted seat order", async () => {
    await writeFile(path.join(directory, "siam.jsonl"), line({ seat: "siam" }) + "\n", "utf8");
    await writeFile(path.join(directory, "austria.jsonl"), line({ seat: "austria" }) + "\n", "utf8");

    const corpus = await loadCorpusDirectory(directory);

    expect([...corpus.keys()]).toEqual(["austria", "siam"]);
  });
});
