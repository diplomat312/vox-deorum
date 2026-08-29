# Stage 2: Migrate the fork to VP 5.4.x

> Part of the multi-line VP plan. Shared decisions are in [README.md](README.md); requirements are in [specs.md](specs.md). Requires Stage 1.

## Objective

Create `vox-deorum-5.4` from `vox-deorum-5.2`, merge the latest upstream `Release-5.4.x`, preserve the Vox Deorum delta, and publish a real `build-5.4.x-...` artifact. The outer repository still ships 5.2 only. The 5.4 artifact is the real input for later line records, cache tests, and installers.

## Approach

This is the risky technical work, so it happens before generic two-line plumbing. Use the existing markers to retain fork changes after taking upstream conflict resolutions, then explicitly inspect the known diplomacy and deal hot spots. The default remains 5.2 during this migration, so new fork changes continue to land there first and are cherry-picked to 5.4.

Merge the latest 5.4.x tag available at execution time. A single marker-guided merge is easier to review than a chain of intermediate release merges.

## Work items

1. Fetch `origin` and upstream tags in a full clone. Record the current marker counts and identify the latest `Release-5.4.x` tag.

2. Create `vox-deorum-5.4` from `origin/vox-deorum-5.2`.

3. Merge the selected upstream release. For modified upstream files, take upstream and reapply the `Vox Deorum:` marked hunks. Keep the fork's build workflow unless upstream changed its build inputs.

4. Review the hot spots: `CvLuaPlayer.cpp`, `TradeLogic.lua`, `CvFlavorManager.cpp`, `CvLuaDeal.cpp`, `CvGame.cpp`, `CvDealClasses.cpp`, and `CvDiplomacyAI.cpp`. Verify `bTreatAsHumanToHuman` still passes through every relevant `CvDeal` API overload.

5. Compare marker counts, run the local Release build, and smoke-test a fresh 5.4 game. Confirm the ConnectionService handshake, one agent decision turn, and a diplomacy interaction. Record that 5.2 savegames are incompatible with this line.

6. Push `vox-deorum-5.4`. Confirm fork CI publishes a `build-5.4.x-...` release with the usual DLL, PDB, and `version.txt` assets.

7. Cherry-pick any 5.2 changes made during the migration to 5.4 with `-x`, then audit unpaired commits and marker counts.

## Verify

- Fork CI is green for `vox-deorum-5.4` and the versioned release contains the selected 5.4.x value in `version.txt`.
- Marker-count differences are explained, the Release build succeeds, and the fresh-game smoke test succeeds.
- The outer repository has no 5.4 pin, cache, installer, or release change yet.

## Done when

Both real fork artifacts exist: one for VP 5.2 and one for VP 5.4. Stage 3 can now add dual-line plumbing without fabricated lines or scratch artifacts.
