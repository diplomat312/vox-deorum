# Multi-Line Vox Populi Support: Staged Implementation Plan

This folder holds the multi-line VP support effort: the specification ([specs.md](specs.md)) and this staged plan. Each numbered file is a self-contained stage with an objective, approach, work items, reuse notes, and verification. Implement in order: **every stage leaves the repo releasable**, stages 1–6 build the machinery while the project still ships exactly one line (5.2), and the real 5.2.7 → 5.4.x migration is the final stage, executed with the playbook and plumbing the earlier stages built.

**Goal in one line:** ship `VoxDeorum-X.Y.Z-vp5.2.exe` and `VoxDeorum-X.Y.Z-vp5.4.exe` from one `main` commit, keep both lines at feature parity via cherry-picks between fork branches, and never again discover an upstream VP release months late.

## Context

Today the `civ5-dll` submodule (fork `CIVITAS-John/vox-populi`, branch `vox-deorum`) sits at upstream `Release-5.2.7` + 349 commits; upstream is at 5.4.5. There is one DLL pin (`scripts/dll-release-info.txt`), one installer, no upstream-watch automation, and no written merge procedure. The 397 `// Vox Deorum:` markers are the only merge tooling. The stale `#define VoxPopuliVersion "5.0.1"` in `scripts/installer.iss` illustrates the missing plumbing: the true version already flows from the VP mod's `<Teaser>` through the DLL build's `version.txt` release asset into `scripts/.dll-cache/`, but nothing committed reads it.

## Locked design decisions

These shape the stages and are argued in [specs.md](specs.md):

- **Fork branches per line** (`vox-deorum-5.2`, `vox-deorum-5.4`); Stage 1 adds the new workflow commit on `vox-deorum-5.2`, then freezes old `vox-deorum` without deleting or aliasing it. A moving alias invites drift and double CI triggers, and bootstrap and CI fetch the gitlink SHA.
- **Outer repo stays single-branch.** Supported lines and the default are recorded in `scripts/vp-lines.txt`; per-line pins live in `scripts/dll-release-info-<line>.txt`; the legacy `dll-release-info.txt` stays as a mirror of the default line's pin for old checkouts and fielded installs.
- **Gitlink policy:** Stage 2 moves the submodule gitlink to the exact commit named by the default line's release pin. Non-default lines are pin files plus fork branches only; the release workflow checks their commits out into the submodule working tree temporarily.
- **Flat `KEY=VALUE` records everywhere:** the cmd scripts parse them with the existing `for /f "delims=="` idiom; JSON is hostile to batch.
- **DLL build tags embed the VP version** (`build-<vp_version>-<timestamp>-<sha7>`) so per-line pin resolution can filter releases by line.
- **Release = one version/tag, N installers**, built by a sequential loop in one job (the version-bump commit must happen exactly once; the npm build is line-independent and runs once; per-line cost is only DLL download + ISCC). The build filters include every shipped mod directory and binary input.
- **Watch workflow lives on the fork's `master`** (GitHub runs `schedule:` only from the default branch) and discovers line branches dynamically, so it never needs per-line edits. Trial merges are textual by default; a manual `workflow_dispatch` can set `try_build` for a Windows build and optionally select the candidate upstream tag.
- **Parity mechanism:** default line first, `git cherry-pick -x` to other lines; audited via unpaired-commit listing and `git grep -c 'Vox Deorum:'` marker counts. Workflow files are part of the parity set.

## Stages

| # | Stage | Objective (expectation at completion) |
|---|---|---|
| 1 | [01-fork-line-branches.md](01-fork-line-branches.md) | **Fork line branches and versioned build tags.** `vox-deorum-5.2` starts at the current `vox-deorum` tip, receives the workflow commit, triggers on `vox-deorum-5.*`, and publishes `build-5.2.7-<ts>-<sha7>`; then `vox-deorum` freezes. Outer repo untouched. |
| 2 | [02-line-records-and-pins.md](02-line-records-and-pins.md) | **Line record and per-line pin plumbing.** `scripts/vp-lines.txt` (`DEFAULT_LINE=5.2`, `LINES=5.2`) and `scripts/dll-release-info-5.2.txt` exist; `.gitmodules` records `branch = vox-deorum-5.2`; the default gitlink moves to the exact release/pin commit; `update-prebuilt-binaries.yml` loops over lines, resolves pins, and mirrors the default pin into the legacy file. |
| 3 | [03-line-aware-scripts.md](03-line-aware-scripts.md) | **Line-aware cmd scripts.** `download-dll.cmd` accepts `--line` (default from `vp-lines.txt`), fails on invalid or missing lines, caches actual DLL/PDB artifacts per line, materializes the selected cache into `scripts\release` on every run, and refreshes top-level metadata; `install.cmd`, `bootstrap.cmd`, and `manual-update.cmd` forward line arguments safely. |
| 4 | [04-multi-installer-release.md](04-multi-installer-release.md) | **Multi-installer release pipeline.** `release.yml` loops over lines: per-line submodule checkout, `build-installer.cmd --line` (npm build once via `--skip-npm`), `installer.iss` parameterized via `/D` defines (`VoxDeorum-X.Y.Z-vp<line>.exe`, true `VoxPopuliVersion`), all installers attached to the single release with a "Which installer?" table. With `LINES=5.2` this ships one renamed installer; validated by a dry run then a real patch release. |
| 5 | [05-upstream-watch.md](05-upstream-watch.md) | **Upstream watch + trial merge.** `upstream-watch.yml` on the fork's `master`: weekly, discovers valid `vox-deorum-5.<number>` branches, lists upstream `Release-*` tags newer than each line's base, trial-merges a selected or newest candidate, and upserts one `upstream-watch`-labeled issue per line. Textual trials are aborted after inspection; clean `try_build` trials are committed only on a local throwaway branch, built on Windows, cleaned up, and never pushed. Cleanup and issue reporting run even when the build fails. |
| 6 | [06-merge-playbook-docs.md](06-merge-playbook-docs.md) | **Merge playbook and doc updates.** `docs/developers/civ5-dll/upstream-merges.md` (merge procedure, conflict strategy per file class, hot-spot checklist, parity procedure, adopt/default-flip/retire checklists) plus updates to releasing.md, civ5-dll overview/building, `AGENTS.md`, and player docs ("two installers, pick one"; cross-line savegame incompatibility). |
| 7 | [07-migrate-to-5.4.md](07-migrate-to-5.4.md) | **The real migration.** Create `vox-deorum-5.4`, merge the latest upstream `Release-5.4.x` per the playbook, verify markers/build/smoke, cherry-pick audit, then the outer adoption: add `5.4` to `LINES`, seed its pin, dry-run and ship a dual-installer release. Flip `DEFAULT_LINE` to 5.4 later, when it has proven stable. That is a separate, deliberate step documented in the playbook. |

## Risks and watch-items (resolved inside the relevant stages)

- **Legacy build tags don't match the new filter** (Stage 2). `update-prebuilt-binaries.yml`'s new `build-<line>.` tag filter cannot match old `build-20260804-…` tags. Stage 1 must publish a new-format release before Stage 2 moves the default gitlink and seeds its pin.
- **Pin resolution must warn-and-skip, not fail** (Stage 2). There is a window (~1 h DLL build) between a fork push and its release; the daily schedule closes it. The resolver can skip an unavailable release, but an explicitly requested invalid or missing line fails in the cmd scripts.
- **Fielded-install back compatibility** (Stage 3). `mcp-server/src/utils/vp-version.ts` is compiled code in the field probing `scripts/.dll-cache/` top level. The per-line cache stores actual DLL/PDB files and every selected-line run materializes them into `scripts\release` while refreshing top-level metadata.
- **Gitlink vs pin drift** (Stages 2, 4). The default gitlink and pin name the same exact release commit; the workflow warns when the fork branch head has moved past it, and `release.yml` restores the gitlink checkout after the per-line loop.
- **cmd injection/quoting** (Stage 3). The `--line` value flows into file paths; validate it against `^[0-9]+\.[0-9]+$` before use and fail if its pin is missing.
- **LFS** (Stage 4). `lua51_win32.dll` is LFS-tracked and line-independent; losing `lfs: true` in checkout would silently ship a pointer file. The release verify step gains a size sanity check.
- **Silent non-scheduling** (Stage 5). A `schedule:` workflow anywhere but the fork's default branch (`master`) never runs.
- **Merge hot spots** (Stage 7). `CvLuaPlayer.cpp`, `TradeLogic.lua`, and the `bTreatAsHumanToHuman` threading through the `CvDeal` API overloads are the known danger zones. The playbook's checklist, not memory, drives the resolution.

## Verification (high level; per-stage detail in each stage)

- **Per stage:** each stage ends with the system observably working in single-line mode: a new-format DLL release exists (1), Stage 2 moves the default gitlink and the pin workflow verifies and maintains it while committing correct per-line files (2), `download-dll.cmd --line 5.2` and no-arg runs both materialize the selected cache with mcp-server's vp-version tests green (3), a dry-run then real release ships the renamed installer (4), a dispatched watch run creates and then updates the tracking issue (5), docs review (6).
- **End-to-end (Stage 7):** the 5.4 branch builds green in fork CI, the outer dry run produces both installers with correct wizard versions and all shipped mod content, a real release publishes both, and a clean-machine install of each line launches the game with the right VP base.
