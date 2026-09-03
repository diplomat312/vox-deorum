# Live duel pilot: one persistent OpenCode session per civilization

Experiment: can a stripped-down, persistent OpenCode session act as one
coherent civilization mind with better prompt-cache reuse than
reconstructed per-turn agent prompts? (See CACHE-COMPARISON.md.)

Game `live-duel` (upstream Vox Deorum v0.12.1): Portugal seat 0, Maria I,
Codex-played, vs Siam seat 1, Ramkhamhaeng, played by the OpenCode harness
on Muse Spark 1.3 Contributor. One session per civ, always: Siam is
`ses_f9a74a908ffeMXPkF3Y5Bh37Ba`.

The model sees only a tiny stable tool API (inspect / communicate /
commit_turn / pass) served by vox-live-server.mjs over the live Vox MCP
backend. Game-state authority, legality checks, and scheduling stay in Vox;
OpenCode is the cognition layer. Capabilities outside the Civ interface
(shell, edit, filesystem, web, subagents, Lua, pause/resume) are denied in
opencode.json; the agent identity is frozen in agent/civ.md.

## Docs

- RUNBOOK.md: seats, turn ops, prefix rules, channels, lock quirks,
  watcher ops, wedge recovery. Start here in the morning.
- NIGHT-LOG.md: chronological shift log with the cache ledger.
- SAMPLE-TRANSCRIPT.md: verbatim turns from the one Siam session.
- CACHE-COMPARISON.md: cache experiment deliverable (pilot numbers
  pre-filled, Unified-Mind side blank with fill procedure).
- channels.json: live group registry (Duel Hall c53f2974).

## Operating rules

- Never restart bridge (:5000) or MCP (:4000) under a watched game without
  an explicit call; leave Civ V rendered.
- Prefix guard: agent/civ.md + opencode.json + vox-civ tool schemas are
  provider-prefix. `node check-prefix.mjs` must stay green; dashboard text
  and inspect results are suffix and freely tunable.
- Failing closed: observation failures never touch the session (verified
  repeatedly via `opencode export` message counts).
- Offline spawns (check-prefix, test-channels routing) go in the ~3min
  quiet gaps between watcher attempts; spawn UNKNOWN during an attempt is
  contention, not breakage.
- Never stack parallel game-lock probes: one cheap call, then one
  get-players with a timeout.

## Queued live verifications (need the backend back)

- Dashboard group-membership line (observe.mjs).
- inspect(diplomacy) opinion lines, default + single-civ views.
- Model tech/policy `path:` walk end to end.
- Portugal seat refresh (civ-state-portugal.json, turn 167).
- T207 cold-start cache row + wall_gap_sec population.
- 21-opportunity Unified-Mind comparison runs (same model).
- inspect(diplomacy, "<civ>") traits block (get-civilization static read).
- Tech `path:` forward edges (`leadsTo`) in one live walk.
- Backpressure: second send in one live turn must reject server-side.
- Compaction flag + `communicates` count on the next telemetry rows.
- Model group lifecycle live: invite/leave/archive forms end to end
- (logic + offline rejects green; prefix re-baselined once for the
- batched description update, one deliberate re-cache while cold).
