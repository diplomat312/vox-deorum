# TurnRouter supervisor notes (fresh4 and on)

## Restart policy

- Graceful: write `STOP-ROUTER` in `live/`. The watch loop exits, the
  in-flight cognition drains to completion, the process ends on its own.
  Confirm the PID is gone before launching a successor.
- Forced: SIGTERM/SIGINT waits up to `--shutdown-drain-ms` (default
  30 s) for the in-flight epoch, then resumes, releases the lock, and
  exits. An abandoned epoch is reconciled on next boot.
- Never launch a second router: startup refuses with exit 3 when a live
  holder owns `router-<game>.lock`. A dead holder's lock is taken over
  loudly (`TAKEOVER` in the log). The lock is git-ignored, like STOP.
- Claims and per-seat watermarks survive restarts
  (`router-state-<game>.json`, `cognition-state.json`); no redispatch of
  claimed epochs. Boot reconciliation closes any `running` watermark as
  `recovered` (orphan finished; see telemetry) or `interrupted`.

## Crash signals and what they mean

- `mcp-server/restart-err.log` with a V8 OOM dump: backend heap death.
  Nothing listens on :4000 afterwards. Revive supervised (heap cap,
  snapshot-on-OOM, captured stdio) and watch heap across long games.
- Router log stalls while the game advances: likely backend down. Check
  `:4000` (MCP), `:5000` (bridge), then the Civ process itself.
- `POST /external/pause` returning `success:false`, or `pauseOk:true`
  with the game advancing anyway: the advisory-pause failure modes.
  The router settles, retries, and refuses (`pause_failed`,
  `game_not_frozen`) rather than thinking unpaused.
- `status_failed` refusals in bursts: status reads failing, usually
  backend down. If many in a row with a live backend, suspect bridge
  overload, not the router.
- Lock `TAKEOVER` lines without an operator restart: a previous process
  died uncleanly. Check its tail before trusting the new instance.

## Telemetry to watch

- `node report-capture.mjs --game=<game>`: cognitions, commits,
  missed, refused, duplicates (split `dupClaimed`/`dupQueued`/
  `dupRunning` in the state file), event vs poll wins.
- `node ../driver/rollup.mjs runs-<game>-*`: cumulative cache-hit
  ratio, cost, model-initiated social ops, timeouts, nudges.
- Per-epoch truth: each seat's `epochs.jsonl` (`pauseOk`, `frozen`,
  `freezeReads`, `collapsed`, `missReason`); per-request truth:
  `telemetry-live.jsonl` (cache splits, latency, cost, compaction).
- Watch for: refusal rate climbing on one seat (short native window vs
  gate latency), `game_not_frozen` (pause not biting), uncached-input
  spikes after long gaps (history re-fetch), any compaction event.

## Backend-drop decision tree

1. `get-game-status` returns empty game ID or turn -1: Civ itself is
   down. Backend revival alone changes nothing; the game must be
   relaunched and its save reloaded first.
2. ECONNREFUSED on :4000 with :5000 answering: MCP server dead.
   Check for an orphan already holding the port before launching
   another (EADDRINUSE means stand down, not retry).
3. :5000 down too: bridge gone; check the Civ process and the DLL
   pipe before touching anything upstream.
4. Game back but turns were missed: expected. Gaps are recorded;
   catch-up horizons in the next observations cover short-window
   seats. Do not replay old epochs.

## Pause (bridge external service) semantics, as observed

- Pause is a request, not a fence: `success:true` means accepted, not
  frozen. The router verifies with three spaced reads.
- Rapid resume-then-pause (single-digit ms) has failed outright;
  the router settles 750 ms after any resume and retries 3x.
- Pause ownership is global: any foreign pause/resume cycle (manual
  probes included) can release a live cognition's hold. Never touch
  `/external/pause` or `/external/resume` by hand during a run.
