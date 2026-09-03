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
