# Stage 4: Multi-installer release pipeline

> Part of the multi-line VP plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md). Requires Stage 3 (line-aware `download-dll.cmd`).

## Objective

`release.yml` produces one installer per line in `LINES` from a single version bump, commit, and tag: `VoxDeorum-X.Y.Z-vp<line>.exe`. Each bundles that line's submodule mod folders and DLL, and shows the line's true VP version in the wizard, retiring the stale hardcoded `VoxPopuliVersion "5.0.1"`. With `LINES=5.2` the pipeline ships a single installer under the new name, validated by a dry run and then one real patch release before any 5.4 work exists.

## Approach

**Sequential loop in one `windows-latest` job, not a matrix.** The version-bump commit, push, and tag must happen exactly once. The npm install, `build:all`, and prune steps are line-independent and run once. Per-line marginal cost is cache materialization or a DLL download plus an ISCC compile (about 10 to 15 minutes). A matrix would need artifact passing and a reunification job for zero parallelism gain.

The mod folders that `installer.iss` bundles (`(1) Community Patch`, `(2) Vox Populi`, `(3a) VP - EUI Compatibility Files`, `VPUI`, `UI_bc1`) come from the **submodule working tree**, so the loop checks out each line's pinned `COMMIT` inside `civ5-dll` before compiling that line's installer. The job captures the original gitlink SHA before the first checkout and restores it in unconditional cleanup, including when a fetch, checkout, download, provenance check, or compile fails. The version-bump commit happens *before* the loop, so the pushed commit can never contain a moved gitlink. Loop order is non-default lines first and default last, so `scripts\release\` and the top-level `.dll-cache` compatibility metadata end in default-line state after a successful run.

Per-line parameters reach Inno Setup as `/D` preprocessor defines; the existing `MyAppVersion` stamping regex in `release.yml` keeps working because the define line survives inside `#ifndef`. `AppId` deliberately stays shared: one Vox Deorum install per machine, so installing one line's build replaces the other (documented in Stage 6).

## Work items

1. **`scripts/installer.iss`**:
   - Wrap `MyAppVersion`, and new `VpLine` + `VoxPopuliVersion`, in `#ifndef` blocks; fix the `VoxPopuliVersion` fallback to the current real value.
   - `OutputBaseFilename`: `VoxDeorum-{#MyAppVersion}-vp{#VpLine}` when `VpLine` is non-empty, today's name otherwise (local builds without defines stay unchanged).
   - `AppVerName`: append `(VP {#VoxPopuliVersion})` so the two installs are distinguishable in Add/Remove.
2. **`scripts/build-installer.cmd`**:
   - Accept `--line X.Y` (resolution as in Stage 3) and `--skip-npm` (skips node download, npm install, `build:all`, and prune for lines 2 through n).
   - Always run `call download-dll.cmd --line %LINE%`. Whether it downloads or hits the per-line, per-mode cache, that command materializes the selected DLL and optional PDB into `scripts\release\`.
   - Read `RELEASE_TAG` and `VP_VERSION` from `dll-release-info-%LINE%.txt` with the existing parse idiom. Before compiling, verify `scripts\release\CvGameCore_Expansion2.dll` exists and `scripts\.dll-cache\release-tag.txt` equals the selected `RELEASE_TAG`. Fail if either check fails, then invoke `ISCC /DVpLine=%LINE% /DVoxPopuliVersion=%VP_VERSION% installer.iss` and report the per-line output name.
3. **`.github/workflows/release.yml`**:
   - Version-bump and commit steps unchanged (drop the single `INSTALLER_NAME` output; keep `VERSION`).
   - Replace the single build step with a pwsh loop: read `vp-lines.txt` and each pin file (`ConvertFrom-StringData`, while pin files remain backslash-free per Stage 2); order lines default-last; capture `git rev-parse HEAD:civ5-dll` as `ORIGINAL_GITLINK_SHA` before changing the submodule, and persist it for later `if: always()` verification. Per line, run `git -C civ5-dll fetch origin <BRANCH>`, `git -C civ5-dll checkout --force <COMMIT>`, then `build-installer.cmd --line <line>` (`--skip-npm` after the first). Each call verifies that its selected cache provenance was materialized before ISCC runs. Collect installer names. Keep `GH_TOKEN` in the environment for the `gh release download` inside `download-dll.cmd`.
   - Wrap the loop in PowerShell `try`/`catch`/`finally`. Check `$LASTEXITCODE` after every native Git and cmd invocation and throw on failure, because native command failures are not terminating PowerShell errors by default. Save the original build `ErrorRecord` in `catch`. In `finally`, always run `git -C civ5-dll checkout --force $ORIGINAL_GITLINK_SHA` and independently capture any restoration failure. After cleanup, rethrow the original build failure if restoration succeeded. If restoration failed, fail the job with a message that reports the restoration error and also preserves the original build error when both occurred.
   - Verify step: loop over the collected names; fail on any missing exe; add a size sanity check on `scripts\release\lua51_win32.dll` (>1 KB, so an unsmudged LFS pointer cannot silently ship).
   - Release step: `files: scripts/dist/VoxDeorum-*.exe`; body gains a generated "Which installer?" table (per line: installer name, `VP_VERSION`, savegame-compatibility note).
   - Dry run: build + verify **all** lines; only commit/push/tag/release stay gated; the summary lists every installer name.
   - Keep `submodules: recursive` and `lfs: true` on checkout.
4. **`README.md`**: install section names the per-line installers and recommends the default line (the version-regex line stays untouched for the stamping step).

## Reuse

- Stage 3's `download-dll.cmd --line`, which selects and materializes cached artifacts with their provenance, and its per-line pin parsing.
- The existing bump, stamp, commit, tag, and release skeleton of `release.yml`. Only the build, verify, and attach middle changes.
- The existing `installer.iss` `{#VoxPopuliVersion}` interpolations (BeveledLabel, info page, skip-VP warning) become correct automatically once the define is fed real data.

## Verify

- Local: `scripts\build-installer.cmd --line 5.2` produces `scripts\dist\VoxDeorum-<ver>-vp5.2.exe`; its log confirms the release DLL exists and the materialized release tag matches the 5.2 pin. A second run with `--skip-npm` skips the npm phase and still succeeds.
- `release.yml` with `dry_run=true`: logs show the per-line submodule fetch, checkout, selected-DLL/provenance verification, and build. All expected exes pass verify, `git status` at the end shows no gitlink change, and the summary lists the names.
- In a scratch workflow run, force a failure after a non-default submodule checkout, once during artifact/provenance handling and once during installer compilation. An `if: always()` verification step confirms `git -C civ5-dll rev-parse HEAD` equals the captured `ORIGINAL_GITLINK_SHA` after each failure. The workflow still fails, reports the injected original error, and separately fails with both errors visible if restoration is also made to fail.
- One real `patch` release: the GitHub release carries `VoxDeorum-X.Y.Z-vp5.2.exe` and the table; installing it on a test machine shows the true VP version (not 5.0.1) in the wizard and installs/launches normally.

## Done when

A real release published from `main` ships the per-line-named installer(s) with correct wizard versions, the dry-run path exercises the full loop, and local no-define ISCC builds still work.
