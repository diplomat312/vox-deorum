# Multi-Line Vox Populi Support: Specifications

Vox Deorum currently ships on a single Vox Populi base (5.2.7) carried by the `civ5-dll` submodule, a fork of `LoneGazebo/Community-Patch-DLL` at `CIVITAS-John/vox-populi`, branch `vox-deorum`, merged forward from upstream release tags by hand. Upstream has since shipped through 5.4.5. This plan makes the project support **multiple VP lines at once**: adopt the latest 5.4.x while keeping 5.2.7 supported for a while (savegame compatibility), with a repeatable upstream-reconciliation process and a release workflow that publishes one installer per supported line.

This document is the specification. The staged implementation plan lives in this folder ([README.md](README.md)).

## What we want to achieve

### 1. Per-line fork branches with full feature parity

- The `CIVITAS-John/vox-populi` fork carries one long-lived branch per supported VP line: `vox-deorum-5.2`, `vox-deorum-5.4`, and so on. Each is upstream's release base for that line plus the full Vox Deorum delta.
- **Full parity**: every Vox Deorum DLL/Lua/XML change ships on every supported line. Features land on the default line's branch first and are cherry-picked (`git cherry-pick -x`) to the others. The existing `// Vox Deorum:` / `-- Vox Deorum:` marker discipline ([AGENTS.md](../../../AGENTS.md)) remains the audit mechanism.
- The historical `vox-deorum` branch is frozen, not deleted. Stage 1 adds the workflow commit to `vox-deorum-5.2`, while the outer repo remains untouched until Stage 2 moves its gitlink to the exact release/pin commit.

### 2. A recorded default line that everything follows

- The outer repo stays **single-branch (`main`)**. Supported lines and the default are recorded in one committed, machine-readable file that scripts and workflows read: `scripts/vp-lines.txt`.
- Each line has its own prebuilt-DLL pin (`scripts/dll-release-info-<line>.txt`); the legacy `scripts/dll-release-info.txt` remains a mirror of the default line's pin so old checkouts and fielded installs keep working.
- The submodule gitlink always points at the **exact commit named by the default line's release pin**. Non-default lines exist as pin files plus fork branches only.
- The cmd scripts (`download-dll.cmd`, `install.cmd`, `bootstrap.cmd`, `manual-update.cmd`) follow the default line when run with no arguments and accept `--line X.Y` to override. Invalid or missing explicit lines fail instead of falling back to another line.

### 3. One release, one installer per line

- A release stays a single version bump, commit, tag `vX.Y.Z`, and GitHub release, but it attaches one installer per supported line, named `VoxDeorum-X.Y.Z-vp<line>.exe`, each bundling that line's complete shipped mod content, including the Community Patch, Vox Populi, EUI compatibility files, VPUI, UI_bc1, Vox Deorum mod, and the prebuilt DLL.
- Per-line caches store the actual DLL and PDB artifacts with their metadata. Every selected-line run materializes those cached artifacts into `scripts\release` and refreshes the top-level compatibility metadata, so the output and provenance always match the selected line.
- The installer wizard shows the **true** VP base version per line (fixing the stale hardcoded `VoxPopuliVersion "5.0.1"` in `scripts/installer.iss`), sourced from the version the DLL build already extracts from the VP mod's `<Teaser>` and publishes as a `version.txt` release asset.
- One Vox Deorum install per machine (`AppId` unchanged): installing one line's build replaces the other. Player docs state which installer to pick and that savegames are not compatible across VP lines.

### 4. Automated upstream awareness

- A scheduled workflow on the fork's default branch watches `LoneGazebo/Community-Patch-DLL` for new `Release-5.x` tags, attempts a throwaway trial merge per line, and maintains **one tracking issue per line** (updated in place) listing new upstream releases and which files conflict. A manual run can set `try_build` to run the trial tree on Windows and can optionally override the candidate tag. The real merge stays a human task.

### 5. A documented, repeatable merge process

- A playbook (`docs/developers/civ5-dll/upstream-merges.md`) covers: merging an upstream release into a line, conflict strategy per file class (guided by the markers and the hot-spot list in [docs/plans/interactive-diplomacy/09-additivity-review.md](../interactive-diplomacy/09-additivity-review.md)), the cherry-pick parity procedure, adopting a new line, changing the default line, and retiring a line.

## Constraints

- **The repo must stay releasable after every stage.** Until the final migration stage, `LINES=5.2` and everything behaves as a one-line system with new plumbing.
- **Back compatibility with fielded installs.** `mcp-server/src/utils/vp-version.ts` (compiled code running in the field) probes `scripts/.dll-cache/version.txt` and `release-tag.txt` at the top level; every selected-line run refreshes those paths. The legacy pin file's `KEY=VALUE` format and the existing batch parse idiom must keep working.
- **Batch-friendly records.** All new records are flat `KEY=VALUE` text files. The four cmd scripts cannot reasonably parse JSON.
- **No new credentials.** All cross-repo reads (fork branches, releases) use public `gh api` / `git fetch` over https; no PAT secrets are introduced.
- **The actual 5.2.7 → 5.4.x merge is the final stage**, executed with the playbook and plumbing the earlier stages built. It is not a prerequisite for any of them.

## Out of scope

- Side-by-side installation of two lines on one machine (AppId intentionally shared).
- CI for the TypeScript services (a known gap, separate concern).
- Automated conflict *resolution*: the watch workflow reports; humans merge.
- Backporting new upstream lines beyond the two currently planned (the machinery generalizes, but only 5.2/5.4 are in scope).

## Success criteria

- A release run publishes `VoxDeorum-X.Y.Z-vp5.2.exe` and `VoxDeorum-X.Y.Z-vp5.4.exe` from one `main` commit, each installer showing its true VP base version in the wizard and containing all shipped mod content.
- `scripts\install.cmd` with no arguments installs the default line; `--line 5.4` installs the other; invalid or missing lines fail; switching lines reuses the selected line's DLL/PDB cache and materializes it into the output directory.
- The upstream-watch issue for each line correctly reports the current base, newer upstream tags, and the trial-merge conflict list, and manual candidate overrides and Windows `try_build` results are reflected in the report.
- The 5.4 migration itself is executed end-to-end using only the playbook, with no undocumented steps.
