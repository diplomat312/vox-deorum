# Hardening brief: backend outages and turn pacing (fresh4 T0-T213)

Context: four persistent OpenCode minds played live Civ V to turn 213
(618 commits, 97% cache reuse). The run ended when the MCP backend died.
This brief lists symptoms with evidence and code pointers, plus the
architectural questions they raise. It prescribes nothing; fixing steps
are wanted from review.

## 1. MCP server dies of heap exhaustion, twice in one day

Symptom: `mcp-server/restart-err.log` holds a V8 fatal dump for PID 25992:
`Ineffective mark-compacts near heap limit`, heap ~3955 MB. Nothing
listens on :4000 now (`Get-NetTCPConnection -LocalPort 4000` empty) while
the bridge on :5000 answers fine. File logging (`mcp-server/logs/`)
stops at 03:29, yet per-seat telemetry shows commits into the 10:xx hour,
so the server was revived after the first death and died again around
11:05 with no new dump (different launcher, no stderr redirect).

Code pointers: `mcp-server/package.json` starts with
`node --inspect=0 dist/index.js`: no `--max-old-space-size`, no restart
supervisor, no health probe. The game SQLite file is 110 MB
(`mcp-server/data/e6fb3412-*.db`), healthy size, so the 4 GB live heap is
not the database file itself. Suspects worth instrumenting: the
`knowledgeManager` store behind `src/utils/knowledge/cached.ts`, per-request
retention anywhere in the MCP session layer, SSE subscriber buffers in
`bridge-service/src/routes/events.ts` (that is the bridge, which survived),
and Winston transport backpressure in `mcp-server/logs/`.

Questions: what owns the process (supervisor, health endpoint, restart
policy)? What is the expected steady-state heap for a 200-turn game, and
which structure actually grew to 4 GB? Should long games rotate or bound
whatever that is, or is the heap flag alone acceptable for now?

## 2. The router has no outage mode

Symptom: with :4000 down, `live/live-mcp.mjs callLive(get-game-status)`
throws ECONNREFUSED. In `live/turn-router.mjs`, `pollOnce` swallows that
(`catch (e) { return; }`) while SSE events from the live bridge keep
firing `handleCandidate` into `dispatch`, which pauses via the bridge,
fails post-pause status, and refuses with `status_failed` while the game
free-runs underneath. The only signals are refusal records and silence.

Questions: should N consecutive status failures trip a circuit breaker
(stop dispatching, hold the game paused, alert loudly) instead of
refusal-looping through live turns? Where should liveness live: router,
bridge, or an external watcher? What is the desired recovery sequence
when the backend returns mid-game (warmup, re-baseline, explicit gap
record)?

## 3. Pause is advisory and occasionally lies

Symptom: `POST /external/pause` returned `{success:false}` for Austria
T17 (epoch file shows `pauseOk:false`, 5 ms after the previous resume)
and dispatch ran 42 s unpaused; Korea T19 returned `success:true` with
`pauseOk:true` yet the game advanced anyway (a concurrent manual resume
is suspected, but unproven). Mitigations already in the router: 750 ms
resume settle, 3x pause retry, `pause_failed` refusal with claim release,
three-read freeze verification (`game_not_frozen` refusal). First gated
epoch (Siam 25:2) shows `frozen:true` over all reads.

Code pointers: pause path is `bridge-service` `/external/*` through
`src/services/dll-connector.ts` (note the timeout/retry shapes near the
DLL call). Router side is `dispatch` in `live/turn-router.mjs`.

Questions: what are the real semantics of the pause call (synchronous
engine freeze, or queued request)? Is there a minimum resume-to-pause
interval the DLL side needs? Can the bridge report actual frozen state
instead of request acceptance, so the router verifies truth rather than
inferring it from three status polls?

## 4. Pacing asymmetry: minds think 15-50 s, native turns take 0.5-6 s

Symptom: every cognition holds the game for 20-50 s while a native turn
needs under a second early and ~6 s at T200. Consequences observed:
144 Korea refusals against 54 cognitions (player 0's sub-second window
closes during the gate's settle+reads); 1552 duplicate triggers (event
and poll both fire per epoch; deduped correctly but noisy); queue
collapses whenever a 40 s cognition spans a turn boundary.

Code pointers: trigger fan-in is `onEventEnvelope` + `pollOnce` in
`live/turn-router.mjs`; per-seat catch-up horizons live in
`live/run-live-turn.mjs` (`horizon_before`/`horizon_after`, e.g. Korea
spanning T200-T211 in one observation).

Questions: is pause-upfront still the right pacing, or time to overlap
cognition with game processing and pause only at the decision deadline
(the previously discussed next step)? Should poll triggers be
suppressed briefly after an event claim to halve trigger traffic? Is
predictive pre-pause for player 0 worth it, or is catch-up coverage for
short-window seats officially sufficient?

## 5. Session and context growth over 200 turns

Symptom: Iroquois holds 647 session messages with ~800 K cache-read
tokens per late request, still committing cleanly. Korea's T211 request
pulled 124 K uncached tokens after a 44-minute gap with `compaction:false`
in telemetry: a full history re-fetch by some layer, unexplained.
No compaction has fired in any seat yet.

Code pointers: session append/parsing in
`experiments/opencode-civ-pilot/driver/session-manager.mjs`; per-request
rows in each seat's `telemetry-live.jsonl`.

Questions: what re-fetched Korea's history (opencode server restart,
eviction, other)? At what context size should rotation or explicit
political checkpoints kick in, and what must a checkpoint preserve that
generic compaction summaries do not? Is 800 K read per turn near any
provider or harness limit we should plan around?

## 6. Observation delta can strand same-turn messages

Symptom: `live/observe.mjs` renders only messages with game turn strictly
greater than the seat's last cognition turn. A batch landing after every
seat cycled (first BATCH4 send, end of T31) is stored and inspectable
but never surfaces. Proposed direction (not implemented): last-seen
message IDs instead of turn watermarks.

Question: ID-based deltas, or `>=` with sender-side dedup, and who owns
the cursor?
