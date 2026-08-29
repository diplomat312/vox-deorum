# Stage 5: Upstream watch and trial merge

> Part of the multi-line VP plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md). Requires Stage 1 (line branches exist to discover). Independent of Stages 2–4.

## Objective

A scheduled workflow in the `CIVITAS-John/vox-populi` fork watches `LoneGazebo/Community-Patch-DLL` for new `Release-*` tags, trial-merges the selected candidate into each `vox-deorum-5.*` branch on a throwaway branch, and maintains **one tracking issue per line**, created once and updated in place, listing the line's current base, newer upstream tags, and the trial merge's conflicting files. No merge is ever pushed. The real merge remains a human task driven by the Stage 6 playbook.

## Approach

**The workflow file lives on the fork's default branch, `master`.** GitHub runs `schedule:` triggers only from the default branch; anywhere else it silently never fires. `master` is the clean upstream mirror plus this one commit, which survives future mirror refreshes trivially. The workflow discovers line branches dynamically (`vox-deorum-5.*` via the API), so adopting or retiring a line never touches it.

**Trial merges are textual only by default.** The fork's compile needs Windows SDK 7.0/7.1 installs (about 30 to 45 minutes), which is too heavy for a weekly run. The actionable weekly signal is "new tags exist" and "these files conflict". A `workflow_dispatch` input `try_build` runs the existing clang build against a clean trial tree for a stronger pre-flight when a merge is being scheduled.

**No outer-repo companion notification**: the issue lives where the merge work happens, GitHub notifications reach the same maintainer, and cross-repo dispatch would need a PAT for no added signal.

## Work items

1. **New `civ5-dll/.github/workflows/upstream-watch.yml`** on fork `master`:
   - Triggers: `schedule` (weekly, for example Monday 06:00 UTC) and `workflow_dispatch` with `try_build: boolean` (default `false`) plus optional `candidate_tag: string` (default empty). `permissions: contents: read, issues: write`.
   - Job `discover` runs on Ubuntu. It uses `gh api /repos/${{ github.repository }}/branches --paginate | jq -sc 'add | map(.name | select(test("^vox-deorum-5\\.[0-9]+$")))'` and writes that single flattened JSON array to the matrix output. Do not concatenate the page arrays or admit malformed branch names.
   - Job `watch` is a matrix over those branches with `fail-fast: false`. It runs on Ubuntu for scheduled and ordinary dispatches. When `try_build=true`, it runs on `windows-2022` and uses the existing Windows SDK and clang setup steps before invoking the existing clang build entry point. All shared discovery, tag-selection, merge, cleanup, report, and issue-upsert steps declare `shell: bash` on both runners, so GNU `sort -V`, `jq`, and the shell syntax are consistent. Windows SDK installation and build-specific steps may use their native shells.
     1. Check out the line branch with `fetch-depth: 0`, `lfs: false`, configure the upstream remote idempotently, and fetch its tags.
     2. Base: `git describe --tags --match 'Release-*' --abbrev=0`. Newer tags: `git tag -l 'Release-*' | sort -V` past the base, split into same-series (same `major.minor`) and cross-series lists.
     3. With no override, select the newest same-series tag if one exists, otherwise select the newest overall tag and flag it as a series upgrade. If no tag is newer than the base, report the line as up to date and skip the merge and build. With `candidate_tag`, require the value to match `Release-*`, confirm it exists as a tag in the `upstream` remote, and confirm it is newer than the branch base. Use that upstream tag exactly, even when automatic selection would choose a different candidate. An invalid or non-newer override fails the matrix entry rather than falling back.
     4. When there is a candidate, create a uniquely named local throwaway branch from the line head and start `git merge --no-ff --no-commit <candidate>`. If the merge conflicts, record `git diff --name-only --diff-filter=U`, mark the build as not attempted because conflicts are unresolved, abort the merge, check out the original ref, and delete the throwaway branch.
     5. If the merge is clean and `try_build=false`, record a clean textual result, abort the uncommitted merge, check out the original ref, and delete the throwaway branch. If the merge is clean and `try_build=true`, keep the merge state, configure a local Git identity if the runner does not already have one, and commit the merge locally with a clearly identified trial message. Run the existing Windows SDK and clang build path against that committed trial tree. Capture pass or fail without terminating the remaining steps, for example with a `continue-on-error` build step whose outcome is copied to an output.
     6. Cleanup, report rendering, and issue upsert run with `if: always()` or an equivalent finally path. Cleanup checks out the original ref, aborts any unresolved merge if needed, and deletes the throwaway branch before rendering the final report. Never push the trial commit or branch. Render `report.md`: base tag, newer-tag lists, selected candidate and selection source, trial result (clean or N conflicts with file list), build result (skipped, not attempted because of conflicts, passed, or failed), timestamp, and playbook link. Call out known hot-spot files by referring to the Stage 6 checklist.
     7. Upsert by the exact title `Upstream watch: <branch>`. Search `gh issue list` with `--state all` and the `upstream-watch` label, select the existing exact-title issue if present, and edit its body in place even if it is closed. A silent edit to a closed issue notifies nobody, so before editing a closed issue compare the new report's newer-tag list against the tags already named in the existing body: if any tag is new, reopen the issue (`gh issue reopen`) so the update is visible; if not, leave it closed — closing the issue mutes tags already reported without blocking future updates. Create the issue only when no exact-title match exists. If the build failed, the matrix entry may conclude failed only after cleanup and the issue update have recorded that failure.
2. **Confirm the `upstream-watch` label exists** (created in Stage 1).

## Reuse

- The Stage 1 line-branch naming convention (`vox-deorum-5.*`) as the discovery key.
- The fork's existing clang build entry point and Windows SDK setup for the optional `try_build` path. No new build machinery is needed.
- The hot-spot file list maintained in the Stage 6 playbook (sourced from [docs/plans/interactive-diplomacy/09-additivity-review.md](../interactive-diplomacy/09-additivity-review.md)). It is referenced, not duplicated.

## Verify

- `gh workflow run upstream-watch.yml` in the fork: the discover job produces one valid matrix array containing `vox-deorum-5.2` and excludes names that do not match `^vox-deorum-5\.[0-9]+$`. The issue records its base, newer-tag lists, and the automatic candidate dictated by the policy: newest same-series if available, otherwise newest overall with a series-upgrade flag. A branch with no newer tags reports up to date without attempting a merge or build.
- Re-dispatch: the **same** issue is edited rather than duplicated. Close the issue and re-dispatch with an unchanged tag list: the body is updated but the issue stays closed. Re-dispatch with a tag the body has not yet named (e.g. a `candidate_tag` override not previously reported): the issue is reopened.
- After the next scheduled window, confirm the workflow actually fired from `master` (guards the silent-non-scheduling risk).
- Dispatch with `candidate_tag=<latest Release-5.4.x>` and `try_build=true`: the explicit, validated, newer upstream tag is used even if automatic selection differs. A clean trial reports the Windows compile result; a conflicting trial reports the files and "build not attempted because conflicts are unresolved." Force a build failure once and confirm cleanup and issue update still run before the matrix entry fails. Confirm the throwaway branch is absent after every path. Dispatch with an invalid or non-newer override and confirm the matrix entry fails without selecting a fallback.

## Done when

The weekly run maintains one accurate, in-place-updated issue per line, and a dry `workflow_dispatch` demonstrates automatic textual selection plus an explicit migration override on the Windows build path.
