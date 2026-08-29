# Stage 5: Upstream release watch

> Part of the multi-line VP plan. Shared design lives in [README.md](README.md); requirements live in [specs.md](specs.md). Requires Stage 2 so both line branches exist.

## Objective

A weekly workflow in the `CIVITAS-John/vox-populi` fork reports newer upstream `Release-*` tags for every `vox-deorum-5.*` branch in one GitHub issue. It provides awareness only. The Stage 6 playbook owns merges and builds.

## Approach

The workflow lives on the fork's default branch, `master`, because GitHub runs scheduled workflows only from the default branch. One Ubuntu job discovers line branches, compares each branch's current upstream base with available tags, renders a compact table, and creates or updates an issue titled `Upstream watch`.

The workflow never merges, builds, pushes, or creates temporary branches. A manual dispatch exercises the same reporting path as the weekly schedule.

## Work items

1. **Add `civ5-dll/.github/workflows/upstream-watch.yml` on fork `master`**:
   - Trigger weekly and through `workflow_dispatch`. Grant `contents: read` and `issues: write`.
   - Discover branches through the GitHub API and accept only names matching `^vox-deorum-5\.[0-9]+$`.
   - Fetch upstream `Release-*` tags once. For each discovered line branch, find its latest reachable release tag and list newer same-series and cross-series tags.
   - Render one issue body with the run timestamp, a per-line table of branch, current base, and newer tags, plus a link to the Stage 6 merge playbook.
   - Find the exact issue title across open and closed issues. Edit the existing issue or create it when absent. Reopen a closed issue when the report lists newer tags.
2. **Confirm the scheduled run executes from `master`** after the next weekly window.

## Reuse

- The `vox-deorum-5.*` branch convention from Stage 1.
- GitHub's existing token and issue API. No new credentials or build setup are needed.

## Verify

- A manual dispatch reports both valid line branches and excludes malformed names.
- Re-dispatching edits the same issue rather than creating another, and reopens it when it was closed while newer tags exist.
- A branch with no newer same-series release is reported as current while still showing any newer major or minor line.
- The workflow leaves every fork ref unchanged.

## Done when

The weekly job maintains one concise upstream-status issue and a manual dispatch proves the report can be refreshed on demand.
