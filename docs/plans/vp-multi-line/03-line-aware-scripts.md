# Stage 3: Line-aware cmd scripts

> Part of the multi-line VP plan. Shared design and watch-items live in [README.md](README.md); requirements in [specs.md](specs.md). Requires Stage 2 (the line record and per-line pin files).

## Objective

The four install-path cmd scripts understand VP lines: `scripts\download-dll.cmd` accepts `--line X.Y` (default resolved from `vp-lines.txt`), reads the per-line pin, caches each line and build mode without breaking mcp-server's version probing, and materializes the selected artifacts into the shared output directory. `scripts\install.cmd` forwards `--line` and warns when the submodule working tree doesn't match the chosen line's pin; `scripts\bootstrap.cmd` no longer mistakes `--line 5.4` for a release tag; `scripts\manual-update.cmd` forwards arguments. No-argument behavior remains today's behavior, resolved through the default line.

## Approach

Edits are surgical: these are fragile batch files with delayed expansion enabled, and the whole point of the single-`main` design is that they change once, not per line.

Line resolution order everywhere: `--line` argument → `VOX_VP_LINE` environment variable → `DEFAULT_LINE` from `scripts\vp-lines.txt`. Validate the selected value against `LINES` and `^[0-9][0-9]*\.[0-9][0-9]*$` (`findstr /R`) before it reaches a path. An explicit CLI or environment override must have a matching per-line pin. The legacy-pin fallback is available only for an unqualified default selection in a transitional checkout, never for an explicit line or a missing configured line.

The cache stores actual artifacts by line and build mode (`.dll-cache\<line>\<mode>\`), including the DLL, optional PDB, `version.txt`, and `release-tag.txt`. `scripts\release\` and `scripts\debug\` remain shared materialized outputs. Before replacing a cache entry, the script validates the downloaded DLL and required metadata in the temporary directory. It then recreates the entire selected line-and-mode cache directory and copies only the new release's files into it. This prevents an older optional PDB or metadata file from surviving a refresh. On every download and cache hit, the script copies the selected cached DLL and optional PDB into the appropriate shared output, removes a stale output PDB when the selected cache has none, and refreshes the top-level `.dll-cache\version.txt` and `release-tag.txt` compatibility metadata. This makes a 5.2 cache hit restore 5.2 bytes after 5.4 was selected. The top-level metadata always describes the artifacts currently materialized for the active mode, preserving mcp-server provenance. `mcp-server/src/utils/vp-version.ts` is not modified.

## Work items

1. **`scripts/download-dll.cmd`**:
   - Replace the single `if "%~1"=="--debug"` arg check with a parse loop accepting `--debug` and `--line X.Y` in any order (shift-based; `%~1`/`%~2` forms to stay safe under delayed expansion).
   - Add line resolution and validation (order, membership, and regex above). Set `RELEASE_INFO=%SCRIPT_DIR%\dll-release-info-%VP_LINE%.txt`. Require that file for an explicit CLI or `VOX_VP_LINE` selection. Only an unqualified default selection may print a transitional-checkout notice and fall back to `dll-release-info.txt`.
   - Extend the pin parse loop with `VP_VERSION` (Stage 4 consumes it via the same idiom).
   - Cache the selected DLL, optional PDB, `version.txt`, and `release-tag.txt` in `%SCRIPT_DIR%\.dll-cache\%VP_LINE%\%BUILD_MODE%`. A matching tag is a cache hit only when that cache contains the selected DLL and metadata.
   - After downloading into the temporary directory, require a valid DLL, a nonempty selected release tag, and valid `version.txt` metadata before changing the cache. When `VP_VERSION` is present in the pin, require `version.txt` to match it. Treat the PDB as optional.
   - Once validation succeeds, remove and recreate the entire `%SCRIPT_DIR%\.dll-cache\%VP_LINE%\%BUILD_MODE%` directory. Copy the new DLL, optional PDB, `version.txt`, and generated `release-tag.txt` into the empty directory. If the new release has no PDB, no PDB remains from the previous cache entry.
   - On both a download and a cache hit, materialize the selected cache into `%OUTPUT_DIR%`. Delete `%OUTPUT_DIR%\CvGameCore_Expansion2.pdb` when the cache has no PDB, then copy the selected `version.txt` and `release-tag.txt` to `%SCRIPT_DIR%\.dll-cache\` for mcp-server compatibility.
2. **`scripts/install.cmd`**:
   - Same parse loop (`--debug`, `--line`); pass `--line %VP_LINE%` through to `download-dll.cmd` only when explicitly set (otherwise let it resolve the default itself).
   - Set `PROJECT_ROOT` from `SCRIPT_DIR` before the repo check. Read `COMMIT` and `BRANCH` from the resolved pin file, then compare the pin to `git -C "%PROJECT_ROOT%\civ5-dll" rev-parse HEAD`. On mismatch, print a **warning**, not an auto-checkout, because the script must not mutate a developer's submodule. Build the displayed repair command from `SCRIPT_DIR` and `PROJECT_ROOT` so it is unambiguous from any current directory: `git -C "%PROJECT_ROOT%\civ5-dll" fetch origin <BRANCH> && git -C "%PROJECT_ROOT%\civ5-dll" checkout <COMMIT>`.
3. **`scripts/bootstrap.cmd`**: guard `set "TAG=%~1"` so an argument starting with `--` is not consumed as a tag (delayed expansion is already on). `call "%INSTALL_SCRIPT%" %*` already forwards flags.
4. **`scripts/manual-update.cmd`**: final line becomes `call install %*`.
5. **`scripts/vox-deorum.cmd`**: explicitly no changes (runtime launcher; touches no pins or DLLs).

## Reuse

- The existing `for /f "tokens=1,2 delims=="` pin parser, `gh release download` with curl fallback, and copy/verify steps in `download-dll.cmd`.
- The legacy-pin fallback keeps Stage 2's mirror as the safety net for an unqualified default in an old checkout.
- `mcp-server/tests/mock/utils/vp-version.test.ts`, the existing test is the compatibility oracle.

## Verify

- `scripts\download-dll.cmd --line 5.2`: DLL/PDB land in `scripts\release\`, the artifacts and provenance metadata are cached under `scripts\.dll-cache\5.2\release\`, and the top-level compatibility copies contain `5.2.7` and the new-format tag.
- The two multi-line tests below run at Stage 3 time, before any real second line exists, against a **fabricated line**: temporarily add `8.8` to `LINES` and write a `dll-release-info-8.8.txt` cloned from the 5.2 pin but naming a *different* existing fork release — an old-format `build-YYYYMMDD-…` tag works, since the script downloads by tag and never parses its format, and its DLL bytes genuinely differ. Remove the line and pin afterward.
- With 5.2 and the fabricated line pinned, run `scripts\download-dll.cmd --line 5.2`, then `--line 8.8`, then `--line 5.2` again. The final `scripts\release\CvGameCore_Expansion2.dll` bytes and `.dll-cache\release-tag.txt` must match the cached 5.2 artifacts and provenance, proving a cache hit rematerializes the selected line rather than accepting stale shared output.
- Populate the fabricated line's release-mode cache from a release that includes a PDB, then repoint its pin at a scratch fork release carrying only the DLL and `version.txt` assets (create it by hand with `gh release create`; delete it afterward) and refresh the same line and mode. The old PDB is absent from both `scripts\.dll-cache\8.8\release\` and `scripts\release\`, while the cached and top-level metadata name only the new release.
- `scripts\download-dll.cmd` with no arguments resolves `5.2` via `vp-lines.txt` and materializes the default-line cache.
- `--line 9.9` and `VOX_VP_LINE=9.9` fail when 9.9 is absent from `LINES` or lacks its pin. `--line bogus` fails the validation guard. An unqualified default selection in a transitional checkout with only the legacy pin still succeeds with its printed fallback notice.
- `npm test` in `mcp-server` (at minimum the `vp-version` tests) passes against the compat copies.
- `scripts\install.cmd --line 5.2` on a checkout whose submodule working-tree `HEAD` matches the pin: no warning. After `git -C civ5-dll checkout` of an older commit, the mismatch warning appears with a repair command rooted at the computed project path.
- `bootstrap.cmd --line 5.2` in a scratch directory does not treat `--line` as a tag (resolves the release tag from `release.txt` as usual).

## Done when

All four scripts preserve bare invocation behavior, honor configured `--line` and `VOX_VP_LINE` values, reject explicit unpinned selections, cache and rematerialize artifacts by line and mode, and keep mcp-server's version metadata tests passing unchanged.
