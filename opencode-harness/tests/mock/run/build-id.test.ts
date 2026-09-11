// Covers the identity a run records, which is what makes two runs comparable.

import { describe, expect, it } from "vitest";
import { harnessBuild } from "../../../src/run/build-id.js";

describe("the build a run was played on", () => {
  it("should name the commit this repository is on", async () => {
    const build = await harnessBuild(process.cwd());

    // Either a commit with an optional marker for uncommitted work, or the word
    // unknown when the repository cannot be read. A version invented by the
    // harness would be worse than none, because a run would look traceable.
    expect(build === "unknown" || /^[0-9a-f]{4,}(\+edits)?$/.test(build)).toBe(true);
  });

  it("should answer unknown rather than fail where there is no repository", async () => {
    expect(await harnessBuild("C:/this/path/is/not/a/repository")).toBe("unknown");
  });
});

