# Multi-Line Vox Populi Support: Staged Implementation Plan

This folder contains the specification ([specs.md](specs.md)) and implementation stages for supporting Vox Populi 5.2 and 5.4 together. Each stage leaves the repository releasable. Stage 1 produces a versioned 5.2 artifact, Stage 2 produces the real 5.4 artifact, and only then does the outer repository gain dual-line plumbing.

**Goal:** publish `VoxDeorum-X.Y.Z-vp5.2.exe` and `VoxDeorum-X.Y.Z-vp5.4.exe` from one `main` commit, keep both lines at feature parity, and report upstream VP releases promptly.

## Context

Today the `civ5-dll` submodule uses the `vox-deorum` fork branch and one DLL record. The fork is based on VP 5.2.7 while upstream has a newer 5.4.x line. The existing `// Vox Deorum:` markers identify the fork delta during an upstream merge. DLL builds already publish `version.txt` from the VP mod's `<Teaser>`, but the installer does not yet use that value.

## Locked design decisions

- **Fork branches per line:** `vox-deorum-5.2` and `vox-deorum-5.4`. The old `vox-deorum` branch is frozen.
- **One outer branch:** `scripts/vp-lines.txt` records `DEFAULT_LINE` and `LINES`. A committed pin file per line names the selected commit and release tag. Pins are updated deliberately, not by a branch-head workflow.
- **Default gitlink:** the `civ5-dll` gitlink matches the default line's pin. It is moved manually when the pin or default changes.
- **Derived branch and downloaded version:** scripts derive `vox-deorum-<line>` and read the selected release's `version.txt`. Pin files do not repeat either value.
- **Per-line caches and explicit selection:** `--line X.Y` selects a listed, pinned line. Without it, scripts use the recorded default. The selected cache always materializes the shared output and current runtime metadata.
- **One release, two installers:** one job builds each selected line sequentially. The runner is ephemeral, so temporary submodule checkouts need no restoration.
- **Simple upstream watch:** one scheduled report lists new tags and links to the playbook. It never attempts a merge or build.
- **Parity:** changes land on the default line first and use `git cherry-pick -x` on the other line. Marker counts and unpaired-commit checks audit the result.

## Stages

| # | Stage | Objective |
|---|---|---|
| 1 | [01-fork-line-branches.md](01-fork-line-branches.md) | Create `vox-deorum-5.2`, publish a `build-5.2.7-...` artifact, and freeze `vox-deorum`. |
| 2 | [02-migrate-to-5.4.md](02-migrate-to-5.4.md) | Create the real `vox-deorum-5.4` branch, merge the latest 5.4.x release, verify it, and publish its artifact. |
| 3 | [03-line-records-and-scripts.md](03-line-records-and-scripts.md) | Add both explicit pins and line-aware scripts, remove the old single-line record and updater, and verify the real 5.2 and 5.4 caches. |
| 4 | [04-multi-installer-release.md](04-multi-installer-release.md) | Build both real lines into one release with true VP version stamping. |
| 5 | [05-upstream-watch.md](05-upstream-watch.md) | Report newer upstream tags for all line branches in one tracking issue. |
| 6 | [06-merge-playbook-docs.md](06-merge-playbook-docs.md) | Document merging, parity, adoption, default flips, retirement, releases, and player choices. |

## Risks and watch-items

- **Versioned artifacts first:** Stage 1 must publish a 5.2 artifact before Stage 2, and Stage 2 must publish a 5.4 artifact before Stage 3 adds either line to the outer repository.
- **Pins are release choices:** each pin must name a release built from its `COMMIT`. The default pin and gitlink must agree.
- **Shared outputs are selected-line outputs:** a cache hit must rematerialize the selected DLL, optional PDB, `version.txt`, and `release-tag.txt`, including the top-level metadata read by the MCP runtime.
- **LFS:** `lua51_win32.dll` is LFS-tracked. Stage 4 adds a release size check so an unsmudged pointer cannot ship.
- **Merge hot spots:** the files and `bTreatAsHumanToHuman` checks listed in [02-migrate-to-5.4.md](02-migrate-to-5.4.md) require explicit review during the real 5.4 merge.

## Verification

- Stages 1 and 2 publish and verify the two real fork artifacts before multi-line scripts exist.
- Stage 3 proves cache isolation with the actual 5.2 and 5.4 artifacts, including 5.2, 5.4, then 5.2 again.
- Stage 4 dry-runs and publishes both installers. Stage 5 updates the single upstream report. Stage 6 is reviewed against the implemented behavior.
