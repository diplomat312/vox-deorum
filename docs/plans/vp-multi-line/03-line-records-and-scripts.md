# Stage 3: VP line records and install scripts

> Part of the multi-line VP plan. This stage runs after the real 5.2 and 5.4 DLL releases exist. The shared design lives in [README.md](README.md), and the requirements live in [specs.md](specs.md).

## Objective

Record the supported lines in `scripts/vp-lines.txt`, pin each line to one real DLL release, and make the install scripts select and cache those releases. The committed per-line pin files are the sole release authority. The default submodule gitlink is kept manually equal to the default line's `COMMIT`.

## Records

Add `scripts/vp-lines.txt` with the default and supported lines:

```text
DEFAULT_LINE=5.2
LINES=5.2 5.4
```

Seed each `scripts/dll-release-info-<line>.txt` from the Stage 1 and Stage 2 releases. Each contains exactly:

```text
RELEASE_TAG=build-<vp-version>-<timestamp>-<sha7>
COMMIT=<full-fork-commit>
```

In the same change, move the outer `civ5-dll` gitlink to the 5.2 pin's `COMMIT`.

The repository is `CIVITAS-John/vox-populi` and the fork branch is derived as `vox-deorum-<line>`. Do not add either value to the pin. Do not add a legacy pin, an environment-variable override, or a transitional fallback. Do not add a branch entry to `.gitmodules`.

## Script changes

1. **`scripts/download-dll.cmd`** parses `--line X.Y` and `--debug`, resolving an omitted line from `DEFAULT_LINE`. It validates the line format, membership in `LINES`, and the presence of its pin before constructing paths. It reads only `RELEASE_TAG` and `COMMIT`, derives the repository and branch, and downloads the selected DLL, optional PDB, and required `version.txt` asset.
2. The script caches complete artifacts under `.dll-cache\<line>\<mode>\`. A cache hit still materializes the selected line into `scripts\release` or `scripts\debug`, removes a stale PDB when the selected release has none, and refreshes the top-level `.dll-cache\version.txt` and `release-tag.txt` files used by the MCP runtime. A downloaded release must have a nonempty DLL and `version.txt` before replacing its cache entry. `VP_VERSION` always comes from that downloaded `version.txt`.
3. **`scripts/install.cmd`** accepts the same flags, downloads the selected line, and warns when the source `civ5-dll` checkout does not match the selected pin. It does not change the developer's checkout. Its repair command uses the derived `vox-deorum-<line>` branch.
4. **`scripts/bootstrap.cmd`** does not consume an argument beginning with `--` as the release tag and forwards the line flags to `install.cmd`.
5. **`scripts/manual-update.cmd`** forwards all arguments to `install.cmd`.
6. **`.github/workflows/update-prebuilt-binaries.yml`** and `scripts/dll-release-info.txt` are removed. There is no scheduled pin polling or branch-head reconciliation. Updating a line requires committing its new pin and, when the default changes, manually moving the default gitlink.

## Release integration

This stage hands Stage 4 the committed pins and the cache materialization. Stage 4 owns how the release workflow consumes them.

## Verification

Run these checks only after real 5.2 and 5.4 artifacts and both committed pins are available:

1. Run `scripts\download-dll.cmd --line 5.2`, then `--line 5.4`, then `--line 5.2` again.
2. Confirm each selected DLL and optional PDB is isolated under its line and mode cache. Confirm the final shared output and top-level MCP metadata describe 5.2 after the last run.
3. Confirm each cache hit rematerializes its selected DLL and removes a stale PDB when the selected real release has none.
4. Confirm no-argument invocation selects `DEFAULT_LINE`, invalid formats and unlisted lines fail, and a missing pin fails before any download.
5. Run `scripts\install.cmd --line 5.2` and `--line 5.4` against matching source checkouts, then against a mismatched checkout. Matching checkouts produce no warning; mismatches produce the derived repair command without changing the checkout.
6. Run `bootstrap.cmd --line 5.4` from a clean source directory and confirm `--line` is not treated as a release tag.
7. Confirm the committed `civ5-dll` gitlink equals the 5.2 pin's `COMMIT`.

## Done when

Both real VP lines can be selected explicitly or by default, their DLL and PDB artifacts remain isolated by line and mode, the shared output can switch back from 5.4 to 5.2, and MCP runtime metadata always follows the selected release.
