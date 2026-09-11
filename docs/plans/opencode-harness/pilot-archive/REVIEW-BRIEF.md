# Fresh-run review brief (Sol)

## What proved out

Four persistent OpenCode sessions (Muse Spark 1.3) played live Civ V end to
end: observe, inspect, communicate, commit through Vox-validated tools.
Fresh1: 65 cognitions, 65 commits, 0 commit failures, 0.907 cumulative
cache-hit ratio, about twelve cents total. Social smoke tests passed with
privacy verified per seat (world, DMs, N-party group with explicit
invite-accept, no leakage). Multi-operation batch contract proven (one call,
four ops, budget charged). Human async message landed on next turns.
Crash-recovery test passed (same session resumed, no replay).

## Fixes implemented from the follow-up brief

1. Seat-turn gating: loops wake only on their own player (SSE PlayerID match
   or active-player poll), refuse on mismatch, epochs record gameTurn,
   expected/trigger/active player ids, and wake source. Verified live.
2. Durable cognition state per seat with retry-before-advance and explicit
   missed_epoch records. No silent drops.
3. Collapse semantics fixed (runningTurn gate plus dedup); clean runs show
   collapsed [].
4. Tool calls fully captured: transcript Tool calls carry arguments, results,
   status, and call IDs; independent tool-calls.jsonl adds durations.
   Model-visible prefix untouched (prefix guard green, offline suites green).

## Findings that changed the design

- Auto-pause holds do not reliably gate mid-game turns. Pre-arming them at
  loop boot froze a fresh game start (confirmed by clearing registrations
  and watching settle resume within seconds). Reverted to per-cognition
  pause only; holds are best-effort, misses stay possible and recorded.
- Poll-granularity misses are the dominant miss source: fast early turns
  plus 5s polls. Fresh3 so far: 41 commits, 0 failures, 19 honestly
  recorded misses. SSE PlayerDoTurn fast path still unverified live.
- Two native (non-harness) game wedges: pinned CPU, static state, Lua dead
  in one case. Save/reload preserved the game ID and the run continued.
- Missed-epoch spam and a corrupted watermark from the first iteration of
  the guard are fixed (dedup on candidate turn, clamp restore to epoch
  truth, no watermark advance on miss).

## Open before tuning

- Event-driven trigger path (verify PlayerDoTurn flow) to cut the miss rate.
- Mind-initiated correspondence lookups and deals: transport proven,
  autonomous use not yet observed. Single-operation social turns only.
- Duplicate empty War Council from a double-run injector (harmless).
- Epoch log spam from an early guard version is historical only.

## Where to look

- live/TRACE-FRESH1.md: chronological per-turn table.
- live/runs-fresh1-*: full epochs, telemetry, transcripts, loop logs.
- live/status-fourway.mjs, trace-index.mjs: observability tools.
- live/fresh1-{batch,recovery}.json: batch and recovery proofs.
- Branch vox-deorum-opencode, all pushed.
