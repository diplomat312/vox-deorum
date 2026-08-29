# Stage 1: Fork line branches & versioned build tags

> Part of the multi-line VP plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md).

## Objective

The `CIVITAS-John/vox-populi` fork has a `vox-deorum-5.2` branch created from the current `vox-deorum` tip. Its DLL build workflow triggers on any `vox-deorum-5.*` branch, tags releases `build-<vp_version>-<timestamp>-<sha7>` (for example, `build-5.2.7-20260901-120000-faf0073`), and publishes at least one release in that format. The old `vox-deorum` branch is frozen. **The outer repo is untouched in this stage**: its gitlink remains at the frozen tip, while the workflow edit creates a new commit on `vox-deorum-5.2`. The first new-format release identifies that new workflow commit.

## Approach

All work happens in the fork. The branch begins as a pointer copy, then the `build_vp.yml` edit creates its first intentional divergence from frozen `vox-deorum`. That edit changes the trigger, tag format, and change filters. Apply the same workflow policy to future line branches by cherry-pick, because workflow files are part of the parity set.

Embedding the VP version in the release tag is what later stages key on: `update-prebuilt-binaries.yml` (Stage 2) filters releases by `build-<line>.` prefix to resolve each line's pin. The version itself is already extracted by the workflow's `get-version` job from the `<Teaser>` in `(2) Vox Populi/Vox Populi.civ5proj`, so no new extraction is needed.

`vox-deorum` is frozen rather than deleted or kept as a moving alias: old outer-repo release tags reference gitlink SHAs on it (they stay reachable through `vox-deorum-5.2`), and a moving alias would double-trigger CI and inevitably drift.

## Work items

1. **Create the branch** (in a full clone of the fork):
   ```
   git fetch origin
   git push origin origin/vox-deorum:refs/heads/vox-deorum-5.2
   ```
2. **Edit `civ5-dll/.github/workflows/build_vp.yml`** on `vox-deorum-5.2`:
   - `push`/`pull_request` triggers: `branches: [ vox-deorum ]` → `branches: [ 'vox-deorum-5.*' ]`.
   - Release tag generation (the "Generate release tag" step in `create-release`): prepend the existing `needs.get-version.outputs.vp_version`:
     `TAG="build-${vp_version}-$(date +'%Y%m%d-%H%M%S')-<sha7>"`.
   - In `detect-changes`, add an installer-mod-content filter for `(1) Community Patch/**`, `(2) Vox Populi/**`, `(3a) VP - EUI Compatibility Files/**`, `VPUI/**`, and `UI_bc1/**`. Include that output in the `setup`, `build-clang`, and `build-msvc` conditions. This covers Lua, XML, modinfo, project, and other packaged mod files, so every branch-head change that an installer can ship receives a release.
   - Keep the existing per-ref `concurrency` group, which already isolates parallel line builds.
3. **Push** and confirm CI publishes a release tagged `build-5.2.7-…` with the usual assets (`CvGameCore_Expansion2-{Release,Debug}.{dll,pdb}`, `version.txt`).
4. **Freeze `vox-deorum`**: leave the branch at its current tip; optionally add branch protection blocking pushes, and note the freeze in the fork's README or branch description.
5. **Create the `upstream-watch` issue label** in the fork (used by Stage 5).

## Reuse

- `build_vp.yml`'s existing `get-version` job (Teaser regex extraction, hard-fails when absent), the version source for the new tag format.
- The existing release asset layout. `download-dll.cmd` and the installer already consume it, so nothing downstream changes shape.

## Verify

- `git ls-remote origin` shows the frozen `vox-deorum` tip as an ancestor of `refs/heads/vox-deorum-5.2`, not necessarily the same SHA.
- The fork has a published release tagged `build-5.2.7-<ts>-<sha7>` whose SHA is the `build_vp.yml` workflow commit and whose `version.txt` asset contains `5.2.7`.
- The outer repo's `git submodule status civ5-dll` SHA is an ancestor of `vox-deorum-5.2` (`git -C civ5-dll merge-base --is-ancestor <gitlink> origin/vox-deorum-5.2`).
- A push to the frozen `vox-deorum` branch is rejected (if protection was added).

## Done when

A new-format `build-5.2.7-<ts>-<sha7>` release exists for the workflow commit, `vox-deorum-5.2` is the live branch, and `vox-deorum` is frozen. The outer repository remains unchanged and still reads its legacy pin until Stage 2 deliberately moves the gitlink and pin to the new authoritative commit.
