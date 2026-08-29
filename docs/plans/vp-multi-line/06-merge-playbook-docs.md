# Stage 6: Merge playbook and documentation

> Part of the multi-line VP plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md). Requires Stages 1–5 conceptually (it documents them); must land **before** Stage 7, which executes it.

## Objective

The upstream-merge procedure, the parity procedure, and every line-lifecycle operation (adopt, flip default, retire) are written down well enough that Stage 7 and every future VP upgrade can be executed from the docs alone. Developer and player documentation reflects the multi-line world.

## Approach

One new canonical playbook beside the existing civ5-dll developer docs, plus targeted edits to the documents that already describe the single-line world. The playbook is procedural (numbered steps, exact commands) because its consumer is a future maintainer mid-merge or an agent driving one. The hot-spot checklist is lifted from [docs/plans/interactive-diplomacy/09-additivity-review.md](../interactive-diplomacy/09-additivity-review.md) rather than invented.

## Work items

1. **New `docs/developers/civ5-dll/upstream-merges.md`** with these sections:
   1. **Model overview**: line branches, `build-<version>-…` tag scheme, `vp-lines.txt` plus per-line pin files, gitlink policy (gitlink = default line's pin), and the version-propagation chain (`<Teaser>` to `build_vp.yml` to `version.txt` asset to `download-dll.cmd` to `.dll-cache` to installer stamp plus knowledge-DB provenance).
   2. **Merging an upstream release into a line**:
      - Prep: configure the upstream remote before fetching it. Run `git remote get-url upstream`. If that command succeeds, run `git remote set-url upstream https://github.com/LoneGazebo/Community-Patch-DLL.git`. If it reports that the remote does not exist, run `git remote add upstream https://github.com/LoneGazebo/Community-Patch-DLL.git`. Then run `git fetch origin` and `git fetch upstream --tags`. These explicit steps are shell-neutral, idempotent, and safe for bootstrap-created clones that only configure `origin`. If the clone is shallow, run `git fetch --unshallow origin` first because a `--depth 1` clone cannot merge tags.
      - Work on a scratch branch; `git merge Release-X.Y.Z` is a plain merge, matching the 50 historical merge commits. Never rebase a published line branch.
      - Conflict strategy by file class: (a) the 8 purely-new Vox Deorum files (`CvConnectionService.*`, `CvConnectionSchema.*`, `ThirdPartyLibs/ArduinoJson.hpp`, `msinttypes`, `build-and-copy.bat`) never conflict. If one does, upstream collided with the name, so stop and investigate. (b) Modified upstream files: **take upstream, then re-apply the `Vox Deorum:`-marked hunks.** Every fork-side change is marked, so the markers enumerate what must survive. (c) Hot-spot checklist: `CvGameCoreDLL_Expansion2/Lua/CvLuaPlayer.cpp`, `(3a) …/LUA/TradeLogic.lua`, `CvFlavorManager.cpp`, `Lua/CvLuaDeal.cpp`, `CvGame.cpp`, `CvDealClasses.cpp`, `CvDiplomacyAI.cpp`. Explicitly re-verify that the `bTreatAsHumanToHuman` parameter is still threaded through **every** `CvDeal` API overload after the merge because upstream adds and renames overloads. (d) `.github/workflows/build_vp.yml` and other fork workflow files: keep ours unless upstream changed build inputs.
      - Post-merge checks: marker-count comparison (`git grep -c 'Vox Deorum:'` before and after, per file type), local build, smoke test (launch the game; verify the ConnectionService handshake and one diplomacy interaction).
      - Push to the line branch. Fork CI publishes the `build-<newversion>-…` release. Then dispatch or await `update-prebuilt-binaries` in the outer repo and confirm the pin file updates.
   3. **Cherry-pick parity procedure**: default line first; `git cherry-pick -x` to the others; audit with `git log --left-right --cherry-pick vox-deorum-A...vox-deorum-B` (unpaired non-merge commits = missing picks) and the marker-count cross-check. Workflow files are part of the parity set.
   4. **Adopting a new line**: create the branch (per §2, as a new-line merge), confirm its first `build-<line>…` release, then the outer-repo PR: add the line to `LINES` in `scripts/vp-lines.txt`, seed or dispatch its pin file, dry-run `release.yml`, update player docs.
   5. **Changing the default line**: edit `DEFAULT_LINE`; update `.gitmodules` `branch=`; move the gitlink (`git -C civ5-dll fetch origin <branch> && git -C civ5-dll checkout <pinned sha>`, commit); the next pin-workflow run regenerates the legacy mirror; update README plus player docs.
   6. **Retiring a line**: remove from `LINES`, delete its pin file, freeze (do not delete) the fork branch, record the last outer release that shipped it.
2. **Update `docs/developers/releasing.md`**: the multi-installer release behavior, `vp-lines.txt`, per-line verify, dry-run guidance, and a pointer to the playbook.
3. **Update `docs/developers/civ5-dll/overview.md` and `building.md`**: branch model, which branch for which line, tag scheme, playbook link.
4. **Update `AGENTS.md`** (merge-discipline section): note the multi-line branch model and that markers plus `cherry-pick -x` are the parity mechanism.
5. **Update player docs** (`docs/players/getting-started.md`, `configuration.md`, `troubleshooting.md`): "two installers, pick one": the default line is recommended; the newer-VP build is for players who want the latest VP; **savegames are not compatible across VP lines**; installing one replaces the other (shared AppId); `--line` for source installs.

## Reuse

- [docs/plans/interactive-diplomacy/09-additivity-review.md](../interactive-diplomacy/09-additivity-review.md): the hot-spot inventory and the `bTreatAsHumanToHuman` analysis.
- `AGENTS.md`'s existing marker convention, restated but not redefined.
- `docs/developers/releasing.md`'s existing structure, extended but not rewritten.

## Verify

- Doc review: a reader who has not followed this plan can answer, from the playbook alone, (a) how to merge `Release-5.4.6` into `vox-deorum-5.4`, (b) how to get a fix from the 5.4 branch onto the 5.2 branch, (c) how to flip the default line, each with concrete commands.
- Every command in the playbook has been executed at least once (Stages 1–5 exercised most; spot-run the rest in a scratch clone).
- Player docs reviewed against the actual Stage-4 release page wording.

## Done when

The playbook and doc updates are merged, and Stage 7 can proceed with the playbook as its only instruction source.
