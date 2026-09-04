# Fresh4 review snapshot: four persistent OpenCode minds, live Civ V

Game `e6fb3412` (Tiny, autoplay): Korea (seat 0), Austria (seat 1), Siam
(seat 2), Iroquois (seat 3). One persistent OpenCode session per civ, model
`opencode-go/muse-spark-1.3-contributor` throughout. Central TurnRouter owns
epoch claiming, pause, dispatch, resume. Snapshot covers T0-T34.

## Headline numbers

| seat | cognitions | commits | missed | refused | poll | event |
|---|---|---|---|---|---|---|
| korea | 13 | 13 | 14 | 10 | 13 | 0 |
| austria | 21 | 21 | 7 | 5 | 12 | 9 |
| siam | 19 | 19 | 10 | 3 | 13 | 6 |
| iroquois | 24 | 24 | 9 | 1 | 15 | 9 |
| total | 77 | 77 | 40 | 19 | 53 | 24 |

Cache/telemetry rollup over all 77 commits: cumulative cache-hit ratio
0.975, total provider cost $0.069, 14 model-initiated social operations,
zero compactions so far. Per-request telemetry (cache splits, latency,
tool calls, cost) is in each seat's `telemetry-live.jsonl`; run
`node ../driver/rollup.mjs runs-fresh4-*` to reproduce. Chronological
per-epoch index with triggers, collapse, timings, tools and cache columns:
`TRACE-FRESH4.md` (via `node trace-index.mjs --game=fresh4`).

## Acceptance against the reliability brief

1. One persistent session per civ: holds. Same session IDs across all turns
   in every seat's telemetry.
2. Cognition wakes on that civ's actual native turn: holds post-fix.
   Every cognition epoch records gameTurn, seat, expected/trigger/active
   player IDs. Poll-only path systematically missed player 0 (sub-second
   native window vs 500 ms poll); the event-first trigger
   (`PlayerDoTurn` + turn derived from last poll + post-pause active-player
   refusal net) now wins ~1 in 3 races and catches P0 whenever the pause
   bites in time.
3. No silent missed decision epochs: holds. Queue-then-duplicate used to
   drop queued cognitions without a record; claims now happen at dispatch,
   the queue dedups explicitly, same-seat supersedes collapse honestly,
   and router-stop drops demand an explicit `router_stopping` miss record.
4. Restart recovery explicit and deterministic: demonstrated twice.
   Durable claim registry + per-seat watermarks restore; zero redispatch
   of claimed epochs; outage gaps recorded as missed epochs.
5. Collapsed telemetry trustworthy: holds. `collapsed` only lists genuinely
   superseded same-seat queued turns (observed live: 17:2 into 18:2).
6. Every tool invocation reconstructable: holds for harness tools
   (tool-calls.jsonl carries seat, turn, args, results; transcript-live.md
   carries observation, model text, commit, applied result). Provider
   hidden reasoning is not captured and not relied on.
7. Actions apply correctly: holds. 77/77 commits applied; one stale commit
   (Austria T17, committed during a runaway) was neutralized by Vox
   action validation (policy already adopted) with zero social sends.
8. Social batching + session continuity intact: demonstrated (below).
9. No prefix/schema change except for correctness: the model-facing tool
   schemas are byte-stable; all churn stayed inside router bookkeeping
   (frozen/freezeReads/collapsed/pauseOk epoch fields).

## Controlled tests

- Restart recovery: two mid-game router restarts, zero duplicate
  cognitions, gaps honestly recorded.
- Stream fallback: router restarted with `SSE-DISABLED`; two full turns
  captured poll-only (30:2, 30:3, both freeze-verified and committed),
  then stream restored. The event path is a latency optimization, not a
  correctness dependency.
- Social batch proof (`batch-proof-fresh4.mjs`): one `executeOperations`
  call as Korea carrying DM Austria, DM Siam, coalition-group update,
  world post. Transport routing 7/7 PASS with Iroquois excluded;
  Austria's next observation carried all three tags and Austria replied
  in-room unprompted; Iroquois's observation carried only the world post.

## Findings (ordered by importance)

1. Pause must gate dispatch. The bridge pause intermittently fails,
   especially on rapid resume-then-pause transitions (Austria T17:
   `pauseOk: false`, 42 s cognition ran unpaused, game free-ran to T18).
   The router now settles 750 ms after any resume, retries a failed pause
   3x, refuses retryably on `pause_failed` (claim released), and
   freeze-verifies with three spaced status reads before any cognition
   (`game_not_frozen` refusal). First gated epoch (Siam 25:2) shows
   `frozen: true` over all reads with a clean commit. Never pause/resume
   the bridge by hand mid-run: pause ownership is global, and one manual
   probe likely released a live cognition's pause (Korea T19 ran 48 s
   with `pauseOk: true` but no actual hold).
2. Refusal net works. Five stale epochs refused with zero stale commits
   during the T17 runaway; the stale T17 commit itself was neutered by
   game-side validation. Refusals are first-class records, not silence.
3. Observation delta has a same-turn blind spot. Only messages with game
   turn strictly greater than your last cognition turn render. A batch
   landing after every seat cycled is stored and inspectable but never
   surfaced (first BATCH4 send proved this). Recommend last-seen message
   IDs over turn watermarks, post-baseline.
4. The freeze gate costs short-window seats. Korea (P0) accrues refusals
   whenever its sub-second window closes during settle+reads. Catch-up
   horizons keep it coherent, but predictive pre-pause is the real fix.
5. Spontaneous diplomacy emerged. 14 model-initiated `communicate` ops
   with zero prompting, including a multi-turn Korea-Austria exchange
   where each side references the other's prior words, all inside the
   persistent strategy sessions. The unified-mind thesis is behaving.
6. Ops notes: launch at most one router (STOP-drain lingers by design;
   confirm the old PID is gone first); set child env via process-env
   inheritance in the launching shell, not layered shell quoting (two
   silent flag drops); `cmd /c start /min` works where Start-Process is
   policy-blocked.

## Changed files in this snapshot

- `live/turn-router.mjs`: event-turn derivation + parked-event flush,
  claim-at-dispatch queue with dedup/collapse/supersede, running-key
  tracking, 750 ms resume settle, pause retry, `pause_failed` refusal
  with claim release, three-read freeze verification, `resumeTracked`,
  explicit stop-drop logging.
- `live/trace-index.mjs`: per-game seat sets (fresh1/fresh4).
- `live/batch-proof-fresh4.mjs`, `live/batch-resend-fresh4.mjs`:
  operator-driven batched social proofs with routing assertions.
- `live/channels-fresh4.json`: coalition group 096ef627 {0,1,2}.
- `live/TRACE-FRESH4.md`, `live/REVIEW-FRESH4.md` (this file): generated.

## Open (post-baseline)

- Predictive pre-pause for player 0's window.
- Last-seen message IDs for the observation delta.
- Model-emitted multi-operation batches in live play (contract already
  advertised: 8 ops/turn/seat; minds currently send singles).
- N-seat deals and correspondence-history inspect.
- Unified Mind cost/quality comparison (needs equivalent-model runs).
