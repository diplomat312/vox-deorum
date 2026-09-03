Night log: live duel pilot, evening 2026-09-02 into morning 2026-09-03, local time.

Game live-duel: Portugal seat 0, Maria I, Codex-played vs Siam seat 1, Ramkhamhaeng, harness on Muse Spark 1.3, one persistent session.
Peace id 12 enacted T178, postures warm both sides. Game reached T207 while Siam idle since T180.

Cache findings:
- Steady state near 99 percent read-hit. Normal turns 1k to 2.6k fresh vs 226k reused.
- Model-visible changes cost one 100k miss each (T145, T156). Dashboard text and inspect results are suffix-safe.
- T177 and T180 cost 120k fresh after 15 to 25min idle: suspected provider TTL expiry. wall_gap_sec now logged per turn.

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
after 15-25min gaps) costs the same ~120k fresh. Cumulative 594967 uncached
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
