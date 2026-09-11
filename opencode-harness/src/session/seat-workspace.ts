// Where a seat works, which must not be inside a repository.
//
// This is the one structural fact the seat context depends on. OpenCode collects
// standing instructions by walking up from the working directory, so a seat whose
// directory sits inside this repository is handed the repository AGENTS.md files:
// ESM import extensions, a logging library, commit message rules. Measured on a
// real seat, that was two files of software engineering guidance arriving in front
// of a Civilization V diplomat, and a setting that switches them off does not exist.
//
// A seat working directory therefore lives outside every repository, and the only
// standing instruction a seat has is the identity the harness writes for it. The
// directory holds nothing but that identity, the seat configuration and the
// OpenCode session state, so a run directory stays free to hold the records an
// analysis reads without any of them becoming a seat instruction.

import { homedir } from "node:os";
import path from "node:path";

// The directory every seat workspace lives under.
//
// Alongside the agent cache in the user home rather than in the operating system
// temp directory, because a long game outlives a temp sweep and because the files
// are worth being able to look at while a run is in progress.
export function seatWorkspaceRoot(): string {
  return path.join(homedir(), ".vox-deorum", "harness-seats");
}

// The working directory of one seat in one run.
export function seatWorkspaceDirectory(runId: string, seat: string): string {
  return path.join(seatWorkspaceRoot(), runId, seat);
}

