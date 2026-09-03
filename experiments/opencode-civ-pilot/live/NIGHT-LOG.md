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

Open: turn-207 cognition with cache numbers, Unified-Mind phase-4 comparison, Portugal seat refresh, policy-walk end to end by the model.
