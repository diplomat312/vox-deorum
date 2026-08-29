# Stage 7: The real migration, adopt VP 5.4.x

> Part of the multi-line VP plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md). Requires **all** prior stages. This stage is executed with the Stage 6 playbook and validates the entire machinery end-to-end.

## Objective

`vox-deorum-5.4` exists in the fork, carrying the latest upstream `Release-5.4.x` plus the complete Vox Deorum delta at parity with `vox-deorum-5.2`; the outer repo lists both lines; and a release publishes `VoxDeorum-X.Y.Z-vp5.2.exe` **and** `VoxDeorum-X.Y.Z-vp5.4.exe`. Flipping `DEFAULT_LINE` to 5.4 is a separate, deliberate later step (playbook §5), taken once 5.4 has proven stable in real games.

## Approach

This is the playbook's "adopting a new line" procedure (Stage 6 §4), executed for real. The merge itself is the risky part: about 68 modified upstream files, and 5.3/5.4 rebalance exactly the systems the fork touches most (deals, diplomacy, flavors, policies). The Stage 5 watch issue provides the starting conflict inventory; the `// Vox Deorum:` markers provide the resolution rule ("take upstream, re-apply marked hunks"); the hot-spot checklist identifies places where mechanical resolution is not enough and behavior must be re-verified, especially `bTreatAsHumanToHuman` threading through the `CvDeal` API overloads.

Merge to the **latest** 5.4.x tag at execution time rather than 5.4.0. Intermediate releases fix bugs, and one big merge with the same marker-guided resolution beats ten sequential ones.

The 5.2 line does not stall meanwhile: parity flows from 5.2 to 5.4 during the transition (5.2 is still the default line where features land first), reversing only after the default flips.

## Work items

1. **Pre-flight**: fetch upstream tags and determine the latest `Release-5.4.x` tag. Dispatch the Stage 5 workflow for `vox-deorum-5.2` with `try_build=true` and `candidate_tag=<that exact tag>`. The override makes this migration trial independent of the automatic same-series candidate rule. Record the pre-merge marker counts. A conflicting trial reports its conflict files and "build not attempted because conflicts are unresolved"; only a clean trial supplies a Windows compile result.
2. **Create the branch**: `git checkout -b vox-deorum-5.4 origin/vox-deorum-5.2` in a full (unshallowed) clone.
3. **Merge** `Release-5.4.<latest>` per playbook §2: marker-guided resolution; hot-spot checklist; `build_vp.yml` kept ours (it already triggers on `vox-deorum-5.*`, so the new branch needs no workflow edits).
4. **Post-merge verification** (playbook §2): marker-count comparison against the pre-merge baseline; local Release build; smoke test: launch, ConnectionService handshake, one full agent decision turn, one diplomacy interaction (deal inspection plus enactment path). Extra attention to savegame behavior: confirm a fresh 5.4 game runs; document (do not fix) that 5.2 saves are incompatible.
5. **Push** `vox-deorum-5.4` to the fork. CI publishes the first `build-5.4.<x>-…` release with `version.txt` = the 5.4 version.
6. **Outer adoption PR**:
   - `scripts/vp-lines.txt`: `LINES=5.2 5.4` (default stays `5.2`).
   - Seed `scripts/dll-release-info-5.4.txt` (or dispatch `update-prebuilt-binaries.yml` and let it seed from the branch head + new release).
   - Verify `scripts\download-dll.cmd --line 5.4` locally: DLL lands, cache under `.dll-cache\5.4\release\`, and after re-running `--line 5.2` the compat copies reflect 5.2 again.
7. **Release**: `release.yml` `dry_run=true`: both installers built, wizard versions correct per line, submodule gitlink untouched. Then a real `minor` release; write `docs/versions/<v>.md` noting the new 5.4 installer, the VP base bump, and the savegame-compatibility callout (house convention from earlier versions like 0.9.0/0.10.0).
8. **Post-release checks**: install each exe on a test machine (they replace each other, as expected); the watch workflow's next run shows **two** issues, with the 5.4 line's base at `Release-5.4.<latest>`.
9. **Parity from here on**: new fork commits land on `vox-deorum-5.2` (still default) and are `cherry-pick -x`'d to `vox-deorum-5.4`; run the parity audit (playbook §3) before each release.
10. **Later, separately: flip the default** (playbook §5), once 5.4 has proven stable across real games: `DEFAULT_LINE=5.4`, `.gitmodules` `branch=`, move the gitlink, README/player-doc updates; parity direction reverses. Eventually retire 5.2 (playbook §6) when its support window ends.

## Reuse

Everything: the Stage 1 branch/tag scheme, Stage 2 records and pin workflow, Stage 3 line-aware scripts, Stage 4 release loop, the Stage 5 conflict inventory, and the Stage 6 playbook as the sole instruction source. If this stage needs an undocumented step, that is a playbook bug to fix as part of this stage.

## Verify

- Fork: `vox-deorum-5.4` CI green; `build-5.4.<x>-…` release with correct `version.txt`; marker counts reconciled against the pre-merge baseline (differences individually explained).
- Outer: pin workflow maintains both pin files across a subsequent fork push to either branch; `download-dll.cmd` works for both lines with isolated caches.
- Release: the published release carries both installers and the "Which installer?" table; each installs and launches the game on its VP base; a knowledge DB from a 5.4 game is stamped `vpVersion: 5.4.<x>` (the existing `mcp-server` provenance path).
- Watch: two per-line issues, both with correct bases.

## Done when

Both lines ship from one `main` release at feature parity, the playbook survived first contact without undocumented steps, and the default-flip remains a documented one-page operation for whenever 5.4 earns it.
