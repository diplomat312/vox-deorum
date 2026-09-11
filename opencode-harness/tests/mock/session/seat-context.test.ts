// Covers what standing context a seat is given: the identity it plays under, the
// place it works, and the instruction files that place would put in front of it.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultSeatIdentity, readSeatIdentity } from "../../../src/session/seat-identity.js";
import { seatWorkspaceDirectory, seatWorkspaceRoot } from "../../../src/session/seat-workspace.js";
import { contextProblem } from "../../../src/session/seat-surface.js";

let directory = "";

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "harness-context-"));
});

afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("the identity a seat plays under", () => {
  it("should introduce a seat as a civilization rather than as a coding agent", () => {
    // The whole point of the identity existing: before it, a seat inherited the
    // repository rules and was told how to write TypeScript.
    expect(defaultSeatIdentity).toContain("Civilization V");
    expect(defaultSeatIdentity).toContain("inspect");
    expect(defaultSeatIdentity).toContain("commit_turn");
    expect(defaultSeatIdentity.toLowerCase()).not.toContain("typescript");
    expect(defaultSeatIdentity.toLowerCase()).not.toContain("esm");
  });

  it("should read an identity a run wrote for itself", async () => {
    const file = path.join(directory, "identity.md");
    await writeFile(file, "  You are a test seat.  ", "utf8");

    expect(await readSeatIdentity(file)).toBe("You are a test seat.");
  });

  it("should refuse an empty identity rather than sending a seat nothing", async () => {
    const file = path.join(directory, "identity.md");
    await writeFile(file, "     ", "utf8");

    await expect(readSeatIdentity(file)).rejects.toThrowError(/empty/);
  });
});

describe("where a seat works", () => {
  it("should put a seat outside every repository", () => {
    const seat = seatWorkspaceDirectory("run-1", "korea");

    // A seat inside a repository is handed that repository AGENTS.md files.
    expect(seat.startsWith(homedir())).toBe(true);
    expect(seat).not.toContain("Vox Deorum");
    expect(seat.endsWith(path.join("run-1", "korea"))).toBe(true);
  });

  it("should keep two seats and two runs apart", () => {
    expect(seatWorkspaceDirectory("run-1", "korea")).not.toBe(seatWorkspaceDirectory("run-1", "austria"));
    expect(seatWorkspaceDirectory("run-1", "korea")).not.toBe(seatWorkspaceDirectory("run-2", "korea"));
    expect(seatWorkspaceDirectory("run-1", "korea").startsWith(seatWorkspaceRoot())).toBe(true);
  });
});

describe("the instruction files a seat directory would collect", () => {
  it("should report a guidance file sitting above the seat directory", async () => {
    // A repository root, marked as one, with a seat directory inside it. This is
    // the arrangement that handed a Civilization diplomat the coding rules.
    const repo = path.join(directory, "repo");
    const seat = path.join(repo, "runs", "run-1", "seats", "korea");
    await mkdir(seat, { recursive: true });
    await mkdir(path.join(repo, ".git"), { recursive: true });
    await writeFile(path.join(repo, "AGENTS.md"), "Write TypeScript.", "utf8");

    const found = contextProblem(seat);

    expect(found).toHaveLength(1);
    expect(found[0]).toBe(path.join(repo, "AGENTS.md"));
  });

  it("should report nothing for a seat directory outside every repository", async () => {
    expect(contextProblem(directory)).toEqual([]);
  });

  it("should stop at a repository root rather than collecting files above it", async () => {
    const outer = path.join(directory, "outer");
    const repo = path.join(outer, "repo");
    const seat = path.join(repo, "runs", "seats", "korea");
    await mkdir(seat, { recursive: true });
    await mkdir(path.join(repo, ".git"), { recursive: true });
    await writeFile(path.join(outer, "AGENTS.md"), "Outer rules.", "utf8");

    expect(contextProblem(seat)).toEqual([]);
  });
});

