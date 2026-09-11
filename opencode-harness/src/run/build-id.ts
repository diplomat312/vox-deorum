// Which build of the harness produced a run.
//
// A run's numbers are only comparable with another run's if the same harness
// produced them, and nothing in a run said so. That is the difference between
// "the seats talked more in this variant" and "the seats talked more after the
// observation changed", and the second is the only one worth acting on. The
// identity is the repository's own commit, so a run can be traced to the code
// that played it without the harness inventing a version of its own.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Read the repository's commit, and whether anything was uncommitted beside it.
//
// A dirty worktree is called out rather than hidden, because a run played on a
// commit with edits on top is not reproducible from the commit alone. A
// repository that cannot be read answers "unknown" rather than failing a run:
// not knowing the build is worth less than losing the game.
export async function harnessBuild(repositoryRoot: string): Promise<string> {
  try {
    const head = await run("git", ["-C", repositoryRoot, "rev-parse", "--short", "HEAD"]);
    const commit = head.stdout.trim();
    if (commit === "") return "unknown";
    const status = await run("git", ["-C", repositoryRoot, "status", "--porcelain"]);
    return status.stdout.trim() === "" ? commit : commit + "+edits";
  } catch {
    return "unknown";
  }
}

