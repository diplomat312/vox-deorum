Night log: live duel pilot, evening 2026-09-02 into morning 2026-09-03, local time.

Game live-duel: Portugal seat 0, Maria I, Codex-played vs Siam seat 1, Ramkhamhaeng, harness on Muse Spark 1.3, one persistent session.
Peace id 12 enacted T178, postures warm both sides. Game reached T207 while Siam idle since T180.

Cache findings:
- Steady state near 99 percent read-hit. Normal turns 1k to 2.6k fresh vs 226k reused.
- Model-visible changes cost one 100k miss each (T145, T156). Dashboard text and inspect results are suffix-safe.
- T177 and T180 cost 120k fresh after ~7-8min idle (session timestamps: 7.0 and
- 7.8min gaps; gaps of 3.4min or less hold 0.99): provider TTL expiry somewhere
- in the ~4-7min range. wall_gap_sec is wired into telemetry but never
- populated — it was added after T180 and no turn has banked since; it starts
- working on the next bank.

Landed tonight:
- Social channels v1: channels.mjs registry, group inbox in observe, group send in communicate, one batched prefix re-cache, 17 asserts pass, Duel Hall c53f2974 verified live end to end.
- Observation retry: get-players 3x10s then fail closed, so no polluted session.
- Policy traversal inspect policies path:X mirroring techPath. Single-result DB shape verified live. Prefix stable throughout.
- RUNBOOK.md with seat config, turn and watcher ops, prefix rules, lock quirks.

Incident: get-players game lock wedged from about 00:05 while cheap calls answer in ms. Services left untouched. Two lingering probe processes killed. watch-207.mjs retries turn 207 up to 40 times, 4min apart (extended from 12 for full overnight coverage), stops on first banked commit.
Diagnosis 00:35 via dashboard status API (read-only): session running, turn 207, not paused, autoPlay on, stock minds off (both seats external). Turn not advancing since 00:05 while Civ V responds and accrues CPU: stuck mid-turn-207 computation or a deadlocked backend worker. Only a service restart clears it: morning call, not done unattended.

Open: turn-207 cognition with cache numbers, Unified-Mind phase-4 comparison, Portugal seat refresh, policy-walk end to end by the model.

Overnight shift (~01:00-02:00, game still wedged at T207, services untouched):
- Session audit via opencode export (read-only, local): 110 msgs, tools ONLY
- vox-civ_inspect/commit_turn/communicate, zero plugin/MCP/skill leakage into
- context. Totals 717k uncached vs 6.04M cache-read (~89% cumulative; steady
- state turns ~99%). No compaction markers. Harness proven lean in practice.
- Vox interface upgrades, all suffix-only except one batched prefix change:
- zone lines now carry posture + zone value and sort stably; rival line adds
- era; tech/policy/city/politics lists sort deterministically (prefix churn
- down); techPath steps include unlocks; inspect(military) takes
- zone:<city|zone> and stats; inspect(diplomacy) takes a civ name and the
- default view adds a city-state table (status + quest count).
- Social: communicate now routes dm:<seat> (pair thread) and
- group:create:<title> (registry + tagged first message) alongside
- world/private/group:<id>. 22 offline asserts pass (17 channels + 5 routing;
- validation paths never touch the live game). One deliberate prefix
- re-baseline (civ.md + inspect/communicate descriptions) while the cache is
- already cold from the wedged idle, so the next live turn pays one cold
- start instead of two.
- Watcher still retrying T207 every 4min, failing closed (~40s each, no
- session pollution). Morning call stands: restart bridge/MCP services, then
- T207 cognition banks and we get fresh cache numbers plus the policy-walk
- end to end by the model. Portugal seat refresh (lastSeenTurn 167) and the
- Unified-Mind phase-4 comparison both need the live lock back.

Cache ledger, 21 banked Siam turns through T180 (telemetry-live.jsonl):
steady state ~0.99 read-hit; model-visible prefix changes (T145 deal-social,
T154, T156 deal-v1) each cost one ~100k+ miss; idle TTL expiry (T177/T180
after 7.0/7.8min idle) costs the same ~120k fresh (T156 sat 49min idle but is
confounded with the deal-v1 prefix change). Cumulative 594967 uncached
vs 4286512 cache-read = 0.878.

turn | uncached | cache_read | hit
116 | 2779 | 252115 | 0.989
119 | 3692 | 260947 | 0.986
121 | 1361 | 179426 | 0.992
123 | 1186 | 182050 | 0.994
125 | 1331 | 184418 | 0.993
127 | 1462 | 187106 | 0.992
129 | 1224 | 189858 | 0.994
130 | 1301 | 192226 | 0.993
132 | 1279 | 194658 | 0.993
134 | 1357 | 197218 | 0.993
135 | 1462 | 199778 | 0.993
137 | 1267 | 202722 | 0.994
139 | 1593 | 205218 | 0.992
140 | 1348 | 208290 | 0.994
145 | 107185 | 213331 | 0.666
148 | 2297 | 324947 | 0.993
154 | 110455 | 220243 | 0.666
156 | 112329 | 112098 | 0.499
165 | 2607 | 226466 | 0.989
177 | 117570 | 234003 | 0.666
180 | 119882 | 119394 | 0.499

Follow-up checks: Siam session re-exported at 110 msgs with identical tool
counts (61 inspect / 30 commit / 3 communicate) — failed T207 watcher
attempts cause zero session pollution. Routing tests extended to 26 asserts
with a createGroup -> tag -> inbox round-trip incl. invite isolation.
Re-checked after 12 total failed T207 attempts (9 + 3 on the restarted
watcher): still exactly 110 msgs. Fail-closed holds across the restart.
Sample transcript deliverable: live/SAMPLE-TRANSCRIPT.md (T165 steady-state,
T177 white-peace acceptance, T180 post-peace — verbatim, one session).
Watcher budget extended 40 -> 100 attempts (~8h, full overnight) and the
watcher restarted on the new budget during a sleep window (old PID 17716 out,
attempt counter fresh, no turn in flight). Game services untouched.
Driver audit: run-live-turn clears the commit file before appending to the
session, so a silent turn can never re-apply a stale commit; telemetry shows
all 21 banked turns committed first-try (zero nudges, zero commit_ok=false).
Phase-4 scaffold (comparison vs Unified Mind, same model). Pilot side,
21 Siam turns, pre-filled from telemetry-live.jsonl: 21 model requests,
594967 uncached input, 4286512 cache-read input, 12691 output,
6415 reasoning, mean turn latency 24.3s wall (observe + model + applies),
94 tool calls (61 inspect / 30 commit_turn / 3 communicate), 1 harmless
apply rejection (T180 duplicate policy, caught by validation), session 110
msgs, steady observation 1.7-5k chars. Unified-Mind side is blank: no
equivalent numbers exist in-tree, so after the lock clears, run the same
count of cognition opportunities through the current Unified Mind path on
Muse Spark 1.3 and capture per-request uncached / cache-read / output /
latency / tool calls the same way before comparing.

Shift ~01:25-01:35 (game still wedged at T207, services untouched):
- Watcher attempts 5-6 failed closed (~40s each, exit=1 commit=false).
- Siam session re-exported: still exactly 110 msgs, 61 inspect / 30 commit /
- 3 communicate. Fail-closed holds across ~17 failed T207 attempts.
- Prefix guard green (fingerprint unchanged); channels suite 26/26 green
- off-window before the change, 30/30 after (21 channels + 9 routing).
- Operational lesson: spawning node children (check-prefix, test-channels
- routing) can fail with spawn UNKNOWN while a watcher attempt is in
- flight; bare-node and execPath spawns succeed seconds later. Rule going
- forward: run offline spawns in the ~3min quiet gaps. Noted in RUNBOOK.
- Social lifecycle: added channels.mjs archiveGroup (active members only;
- archived groups leave inbox/visible sets and reject later sends with
- 'unknown group'; world-broadcast history is preserved) plus 5 offline
- asserts. No model-visible change: prefix untouched, result-content only.
-
Shift ~01:50-01:55 (game still wedged at T207, services untouched):
- Watcher attempt 10 failed closed; session re-exported at 110 msgs.
- Dashboard: stable group-membership line in observe.mjs (visibleGroups,
- active-only). Quiet channels no longer drop out of the mind between
- crises; line is stable across turns while membership is unchanged, so
- steady-state cost is ~0 fresh tokens. Suffix-only: prefix guard green,
- node --check clean on observe.mjs and run-live-turn.mjs.
- run-live-turn.mjs: corrected the stale wall_gap_sec comment (15-25min ->
- ~7-8min idle TTL per session timestamps). wall_gap_sec wiring verified by
- read: populates on the next banked turn. Live render of the membership
- line verifies on T207 after the restart.
-
Shift ~01:53-01:56 (game still wedged at T207, services untouched):
- Watcher attempt 11 failed closed; suite 33/33 green off-window
- (24 channels + 9 routing), prefix guard green.
- Social robustness: group titles are now sanitized at creation (brackets
- and newlines collapsed) so a title like "War [Council]" can no longer
- silently break tag/parse matching and lose the group's messages.
- Store invariant, registry-only change: no model-visible prefix impact.
- 3 new offline asserts (sanitize, tag/parse round-trip, inbox delivery).
-
Shift ~01:54-02:00 (game still wedged at T207, services untouched):
- Watcher attempt 11 failed closed; no STOP file; game procs alive.
- New deliverable live/CACHE-COMPARISON.md: cache experiment as a
- first-class doc. Method, full 21-turn pilot table regenerated from
- telemetry-live.jsonl (matches: 594967 uncached / 4286512 read / 0.878
- cumulative), steady/cold split (16 x ~0.992 with ~1.7k fresh/turn vs
- 5 x ~113k fresh/turn), session-export cross-check, TTL finding, blank
- Unified-Mind side with the exact fill procedure, and next-rows checklist
- (T207 cold start, policy-walk, Portugal refresh). Numbers verified
- against source, not copied from prose.
-
Shift ~01:56-02:01 (game still wedged at T207, services untouched):
- Watcher attempt 12 failed closed. Prefix stable, suite 33/33, --check
- clean on the edited server.
- Vox interface: inspect(diplomacy) now enriches BOTH views with opinion
- prose from get-opinions (spec read in mcp-server source: per-major
- OurOpinionOfThem / TheirOpinionOfUs / MyEvaluations). Default view gets
- short per-civ lines; the single-civ zoom gets only that civ's line.
- Suffix-only (result content), try/catch-optional, no schema or identity
- change. Live verification queued for post-restart (backend wedged; no
- live probes run tonight). Next walker candidate from the catalog:
- get-civilization traits on the diplomacy zoom; skipped for now to keep
- this change to one new live call per view.
-
Shift ~02:01-02:05 (game still wedged at T207, services untouched):
- Watcher attempt 12 failed closed; session re-exported at 110 msgs.
- Doc-consistency pass: RUNBOOK had a duplicated spawn-contention bullet
- from overlapping edits (stale 26/26 + 30/30 lines); merged to one live
- line (33/33). NIGHT-LOG history entries left intact.
- Traits-walker spec confirmed from source: get-civilization is a static
- local-DB read (civ/leader/trait, same DatabaseQueryTool shape as
- get-technology), so the diplomacy zoom can append rival traits/UU/UB
- with zero game-lock risk and stable-per-game cache behavior. Ships after
- the opinion-lines enrichment validates live. No live probes run tonight.
-
Shift ~02:03-02:06 (game still wedged at T207, services untouched):
- Watcher attempt 13 failed closed; game procs + watcher alive, no STOP.
- New live/README.md: pilot overview, doc index, operating rules, queued
- live verifications. Fresh off-window evidence: suite 33/33, prefix
- stable (fingerprint unchanged).
-
Shift ~02:04-02:07 (game still wedged at T207, services untouched):
- Watcher attempt 13 failed closed; session re-exported at 110 msgs with
- communicate calls still at 3 (no stray sends).
- Pre-live review of the two queued changes (290bff29 opinions, 608a385d
- membership): opinion labels verified against get-opinions source
- (OurOpinionOfThem = requester's view of target; string/unmet entries
- skipped; caps hold); membership line is active-only, stable while
- membership is unchanged, and degrades to a stable fallback inside the
- existing groups-optional catch. No bugs found; both stay queued for
- post-restart live verification.
-
Shift ~02:07-02:10, pre-restart baseline snapshot (for before/after):
- Civ V alive: PID 25100 (started 9:01pm), CPU accruing. Game is healthy;
- the wedge is in the backend, so morning restart is services only.
- Node 41744 CPU 542 / 1884 CPU 348, both hot since 8:57pm, still
- accruing: consistent with a worker spinning on the stuck game lock.
- Watcher attempt 13 failed closed; Siam session 110 msgs; Portugal seat
- file lastSeenTurn 167 (refresh queued post-restart). No STOP file.
