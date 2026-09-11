// Covers the tail a run is watched through: that it reads only what is new, and
// that a line still being written is held back until it is whole.

import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readableScope, readNewLines, type TailPosition } from "../../../src/analysis/watch-run.js";

describe("watching a run", () => {
  let directory = "";
  let file = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "harness-watch-"));
    file = path.join(directory, "log.jsonl");
  });

  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("should read nothing from a file that does not exist yet", async () => {
    const position: TailPosition = { offset: 0, remainder: "" };

    expect(await readNewLines(file, position)).toEqual([]);
    expect(position.offset).toBe(0);
  });

  it("should read whole lines and then only what is new", async () => {
    await writeFile(file, "one\ntwo\n", "utf8");
    const position: TailPosition = { offset: 0, remainder: "" };

    expect(await readNewLines(file, position)).toEqual(["one", "two"]);
    expect(await readNewLines(file, position)).toEqual([]);

    await appendFile(file, "three\n", "utf8");

    expect(await readNewLines(file, position)).toEqual(["three"]);
  });

  it("should hold back a line that is still being written", async () => {
    await writeFile(file, "complete\npartial", "utf8");
    const position: TailPosition = { offset: 0, remainder: "" };

    // The partial line is not handed over, because a half-written turn would
    // read as a damaged one.
    expect(await readNewLines(file, position)).toEqual(["complete"]);

    await appendFile(file, " now whole\n", "utf8");

    expect(await readNewLines(file, position)).toEqual(["partial now whole"]);
  });

  it("should skip blank lines without losing the ones around them", async () => {
    await writeFile(file, "one\n\n\ntwo\n", "utf8");
    const position: TailPosition = { offset: 0, remainder: "" };

    expect(await readNewLines(file, position)).toEqual(["one", "two"]);
  });
});

describe("reading a scope while watching", () => {
  it("should say who a private message went to rather than showing the key", () => {
    // The log stores a direct message as a key both seats can find, but a
    // person watching wants to see who was speaking to whom.
    expect(readableScope("dm:austria:siam", "siam")).toBe("to austria");
    expect(readableScope("dm:austria:siam", "austria")).toBe("to siam");
  });

  it("should name the room and the council", () => {
    expect(readableScope("world", "korea")).toBe("to everyone");
    expect(readableScope(undefined, "korea")).toBe("to everyone");
    expect(readableScope("group:e-3", "korea")).toBe("to the council");
  });
});
