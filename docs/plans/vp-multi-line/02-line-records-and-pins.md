# Stage 2: Line record & per-line pin plumbing

> Part of the multi-line VP plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md). Requires Stage 1 (a new-format `build-5.2.7-…` release must exist before the new pin workflow lands).

## Objective

The outer repo records its supported VP lines and default in `scripts/vp-lines.txt`, carries one pin file per line (`scripts/dll-release-info-<line>.txt`), and `.github/workflows/update-prebuilt-binaries.yml` maintains all of them: gitlink-authoritative for the default line, fork-branch-head for the others, with the legacy `scripts/dll-release-info.txt` regenerated as an exact mirror of the default line's pin. With `LINES=5.2` the observable behavior is today's, in the new format.

## Approach

Everything is flat `KEY=VALUE` so the cmd scripts keep their `for /f "tokens=1,2 delims=="` parse loop. The legacy pin file survives as a mirror because fielded installs, old checkouts, and the not-yet-updated scripts (Stage 3 lands after this) all read it; its parser ignores unknown keys, so the mirror can carry the new fields harmlessly.

The pin workflow's core change is a per-line loop replacing the single-SHA lookup. Two authority rules keep the pointers honest:

- **Default line:** the submodule gitlink is authoritative (as today). It is the human-controlled "what the default line ships" pointer. The workflow warns and leaves the pin unchanged when the fork branch head has moved past it. A human moves the gitlink before that newer default-line commit can become the default pin.
- **Other lines:** no gitlink exists, so the fork branch head is the pin, resolved via `gh api`.

"No release found" becomes **warn + skip** instead of today's `exit 1`: after any fork push there is a ~1 h window before the DLL build publishes, and a new line has no release at all until its first build. A daily `schedule` trigger closes the gap. It is necessary because non-default-line DLL builds happen on fork pushes that never touch this repo, so no push trigger here would ever fire for them.

### File formats

`scripts/vp-lines.txt` (committed, hand-edited; source of truth):

```
DEFAULT_LINE=5.2
LINES=5.2
```

(`LINES` is space-separated and ordered; becomes `5.2 5.4` in Stage 7.)

`scripts/dll-release-info-<line>.txt` (committed, workflow-maintained):

```
RELEASE_TAG=build-5.2.7-20260901-120000-faf0073
COMMIT=faf007337889697cf9df6f0f05ff7676c05030e4
REPO=CIVITAS-John/vox-populi
BRANCH=vox-deorum-5.2
VP_VERSION=5.2.7
```

`BRANCH` tells the pin workflow and `release.yml` which fork branch this line tracks; `VP_VERSION` (from the release's `version.txt` asset) is what Stage 4 stamps into the installer, fixing the stale `5.0.1`. Keep these files free of backslashes. Stage 4 reads them with PowerShell's `ConvertFrom-StringData`, which treats `\` as an escape.

## Work items

1. **Add `scripts/vp-lines.txt`** with `DEFAULT_LINE=5.2` / `LINES=5.2`.
2. **Move the outer `civ5-dll` gitlink** to the exact Stage 1 workflow commit that produced the first new-format release. This is the one authoritative default commit for the release, gitlink, and pins.
3. **Hand-seed `scripts/dll-release-info-5.2.txt`** from that same Stage 1 release: `COMMIT` = the moved gitlink SHA, `RELEASE_TAG` = that release's new-format tag, `BRANCH=vox-deorum-5.2`, and `VP_VERSION=5.2.7`. Seed `scripts/dll-release-info.txt` as an exact copy. The first pin-workflow run is then a no-op diff, which checks that all three references agree.
4. **Add `branch = vox-deorum-5.2`** to `.gitmodules` (documents the default line, makes `git submodule update --remote` sane, and is updated on every default-line change per the playbook).
5. **Rework `.github/workflows/update-prebuilt-binaries.yml`**:
   - Triggers: keep `push: main` + `workflow_dispatch`; add `schedule: cron '0 7 * * *'`.
   - Replace the single-SHA steps with a loop over `LINES` read from `vp-lines.txt`:
     - Resolve `BRANCH` from the line's existing pin file, falling back to the `vox-deorum-<line>` convention for first seeding.
     - Default line: `SHA` from `git submodule status civ5-dll`; also fetch the branch head via `gh api /repos/CIVITAS-John/vox-populi/branches/<BRANCH>` and emit `::warning::` if it differs.
     - Other lines: `SHA` = branch head from the same API call.
     - Find the release: `gh api --paginate /repos/CIVITAS-John/vox-populi/releases`, filter `tag_name | startswith("build-<line>.")` and match `sha7` in the tag (fallback: full SHA in the body). No match → `::warning::` + `continue`.
     - Fetch the release's `version.txt` asset → `VP_VERSION`; write the pin file.
   - After the loop: `cp scripts/dll-release-info-$DEFAULT_LINE.txt scripts/dll-release-info.txt`.
   - Commit step: stage `scripts/dll-release-info*.txt`; keep the existing diff-guard/commit/push flow.

## Reuse

- The existing `git submodule status` SHA extraction and `gh api` release matching in `update-prebuilt-binaries.yml`, restructured into the loop rather than rewritten.
- The Stage 1 tag format. The `startswith("build-<line>.")` filter is the counterpart of embedding the version in the tag.
- The existing auto-commit steps (`github-actions[bot]`, diff guard) unchanged.

## Verify

- Push to `main`; the triggered run produces **no commit** and no warnings because the moved gitlink, the Stage 1 release, and both seeded pins name the same commit.
- `gh workflow run update-prebuilt-binaries.yml` after a later fork push to `vox-deorum-5.2`: the log warns that the branch head differs from the default gitlink, and produces no default-pin change. After a human moves the gitlink to a released commit, the next run updates `dll-release-info-5.2.txt` and the legacy mirror identically.
- `scripts\download-dll.cmd` (still the Stage-0 script, reading the legacy file) succeeds against the new-format tag, proving the mirror keeps old consumers working.
- Temporarily add a fake line to `LINES` in a scratch branch run: the workflow warns and skips it without failing.

## Done when

The pin workflow maintains per-line pin files plus the legacy mirror across push, dispatch, and daily triggers. The seeded 5.2 pin, legacy mirror, and gitlink all name the Stage 1 release commit, later default-branch drift only warns until a human moves the gitlink, and the unchanged Stage-0 scripts still download the DLL successfully.
