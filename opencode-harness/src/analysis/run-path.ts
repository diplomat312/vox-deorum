// Where a run lives, worked out from whatever a person typed.
//
// Every reading tool takes a run, and each of them used to join what it was
// given onto opencode-harness/runs. That is right from the repository root and
// wrong from anywhere else, where a path that plainly exists turns into a path
// that plainly does not. A path that is already a directory is therefore used as
// it stands, and only a bare name is looked for under the usual directory.

import { statSync } from "node:fs";
import path from "node:path";

// Where runs live when nothing else is said.
export const defaultRunsDirectory = path.join("opencode-harness", "runs");

// Whether a path is a directory that exists.
function isDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

// Resolve the directory of one run.
//
// An absolute path is taken as given, then a relative path that names a real
// directory, and only then a bare name looked for under the runs directory. The
// fallback is returned even when it does not exist, so the caller reports the
// path it tried rather than a directory with no meaning.
export function resolveRunDirectory(name: string, runsDirectory: string = defaultRunsDirectory): string {
  if (path.isAbsolute(name)) return name;
  const direct = path.resolve(name);
  if (isDirectory(direct)) return direct;
  return path.resolve(runsDirectory, name);
}

// Resolve a directory that holds several runs, such as a runs or matrix folder.
export function resolveRunsDirectory(name: string, fallback: string = defaultRunsDirectory): string {
  if (path.isAbsolute(name)) return name;
  const direct = path.resolve(name);
  if (isDirectory(direct)) return direct;
  return path.resolve(fallback, name);
}

