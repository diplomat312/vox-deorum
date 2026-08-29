# Stage 1: Fork the 5.2 line and publish its artifact

> Part of the multi-line VP plan. Shared decisions are in [README.md](README.md); requirements are in [specs.md](specs.md).

## Objective

Create `vox-deorum-5.2` from the current `vox-deorum` tip. Its DLL build workflow runs for `vox-deorum-5.*` branches and publishes tags in the form `build-<vp_version>-<timestamp>-<sha7>`. Freeze the old branch. The outer repository remains unchanged.

## Approach

The new branch copies the current fork tip. Its first workflow commit changes the trigger and release tag, producing a 5.2 artifact that later stages can pin explicitly. Future line branches receive the workflow by cherry-pick because workflows are part of the parity set.

The workflow already extracts the VP version from the Vox Populi project's `<Teaser>`. Its release asset `version.txt` remains the source for installer version stamping.

## Work items

1. Create the fork branch in a full clone:

   ```
   git fetch origin
   git push origin origin/vox-deorum:refs/heads/vox-deorum-5.2
   ```

2. Update `civ5-dll/.github/workflows/build_vp.yml` on `vox-deorum-5.2`:

   - Change push and pull request branches from `vox-deorum` to `vox-deorum-5.*`.
   - Generate tags as `build-${vp_version}-<timestamp>-<sha7>`.
   - Include `(1) Community Patch/**`, `(2) Vox Populi/**`, `(3a) VP - EUI Compatibility Files/**`, `VPUI/**`, and `UI_bc1/**` in the installer-content change filter and its build conditions.
   - Keep the existing per-ref concurrency group.

3. Push the workflow commit and confirm that it publishes the normal DLL, PDB, and `version.txt` assets under a `build-5.2.7-...` release tag.

4. Freeze `vox-deorum` at its current tip. Branch protection is optional, but no later changes may target it.

## Verify

- `vox-deorum-5.2` contains the frozen `vox-deorum` tip.
- The new-format 5.2 release targets the workflow commit and its `version.txt` contains `5.2.7`.
- The outer repository's submodule gitlink is still the prior SHA. Stage 3, not this stage, aligns it with an explicit pin.

## Done when

`vox-deorum-5.2` is the live 5.2 line, `vox-deorum` is frozen, and a versioned 5.2 artifact exists for Stage 2 and Stage 3.
