# Cache experiment: persistent OpenCode civilization session vs Unified Mind

First-class deliverable for the pilot hypothesis: one persistent,
stripped-down OpenCode session per civilization gives substantially better
provider prompt-cache reuse than reconstructed per-turn agent prompts.

## Method

- One civilization (Siam, seat 1) = one OpenCode session
  (`ses_f9a74a908ffeMXPkF3Y5Bh37Ba`), one model
  (`opencode-go/muse-spark-1.3-contributor`), frozen identity
  (`agent/civ.md`), frozen tool schemas (`vox-civ` MCP: inspect /
  communicate / commit_turn / pass). Guarded by `check-prefix.mjs`.
- Every banked turn appends one row to `runs-siam/telemetry-live.jsonl`
  from the session's usage-counter delta: uncached, cache-read,
  cache-write, output, reasoning, wall latency, tool calls.
- Per-turn hit ratio = read / (read + uncached + write).
- Cumulative hit = sum(read) / sum(read + uncached + write).
- Session-lifetime counters (`opencode export`) are a cross-check, not the
  primary metric: they cover a wider request scope than turn deltas.
- Warming DISABLED for the baseline. Compaction: none observed (110 msgs).

## Pilot side (pre-filled, regenerated from telemetry-live.jsonl)

21 banked Siam turns, T116-T180. Five cold turns (model-visible prefix
change at T145/T154/T156, idle TTL expiry at T177/T180) vs sixteen
steady-state turns.

| turn | uncached | cache_read | hit | latency_ms | tools |
|------|----------|------------|-----|------------|-------|
| 116 | 2779 | 252115 | 0.989 | 23992 | inspect x2, commit |
| 119 | 3692 | 260947 | 0.986 | 26597 | inspect x4, commit |
| 121 | 1361 | 179426 | 0.992 | 19379 | commit |
| 123 | 1186 | 182050 | 0.994 | 16132 | commit |
| 125 | 1331 | 184418 | 0.993 | 20074 | commit |
| 127 | 1462 | 187106 | 0.992 | 15216 | commit |
| 129 | 1224 | 189858 | 0.994 | 15295 | commit |
| 130 | 1301 | 192226 | 0.993 | 22708 | commit |
| 132 | 1279 | 194658 | 0.993 | 19261 | commit |
| 134 | 1357 | 197218 | 0.993 | 15713 | commit |
| 135 | 1462 | 199778 | 0.993 | 25410 | commit |
| 137 | 1267 | 202722 | 0.994 | 17419 | commit |
| 139 | 1593 | 205218 | 0.992 | 20047 | commit |
| 140 | 1348 | 208290 | 0.994 | 20268 | commit |
| 145 | 107185 | 213331 | 0.666 | 29076 | communicate, commit |
| 148 | 2297 | 324947 | 0.993 | 28995 | communicate, commit |
| 154 | 110455 | 220243 | 0.666 | 83385 | commit |
| 156 | 112329 | 112098 | 0.499 | 23071 | commit |
| 165 | 2607 | 226466 | 0.989 | 20619 | commit |
| 177 | 117570 | 234003 | 0.666 | 26843 | communicate, commit |
| 180 | 119882 | 119394 | 0.499 | 21548 | commit |

Aggregates (turn deltas): uncached 594967, cache-read 4286512,
cache-write 0, output 12691, reasoning 6415, cumulative hit 0.878.
Mean wall turn latency 24.3s (observe + model + applies).

Steady (n=16): avg 1722 fresh vs 211715 re-read per turn, hit 0.992.
Cold (n=5): avg 113484 fresh per turn (prefix change or TTL expiry).

Session cross-check (`opencode export`, 110 msgs, 61 inspect / 30
commit_turn / 3 communicate, zero non-vox-civ tool leakage): lifetime
717k uncached vs 6.04M cache-read (~0.89 cumulative). All 21 banked turns
committed first-try; one harmless apply rejection (T180 duplicate policy,
caught by validation). Steady observation 1.7-5k chars.

TTL finding: gaps of 3.4min or less hold ~0.99; T177/T180 cost a full
~120k re-read after 7.0/7.8min idle (session timestamps). Effective
provider prefix TTL somewhere in the ~4-7min range. `wall_gap_sec` in
telemetry starts populating on the next banked turn.

## Unified-Mind side (blank: fill after the lock clears)

Run the same count of cognition opportunities (21) through the current
Unified Mind path on the SAME model (Muse Spark 1.3 Contributor) and
capture per request: uncached input, cache-read input, cache-write
input, output, reasoning, latency, tool calls. Then compare: cached
input, uncached input, total provider-visible input, latency, request
count, quality/coherence, failures, context growth. No equivalent
numbers exist in-tree today.

## Unified-Mind instrumentation plan (no code taken, hook points surveyed)

- Fan-out to cover per turn: strategist variants
- (vox-agents/src/strategist/agents: simple-strategist plus briefed /
- learned / staffed derivatives, null/none/human) plus envoy agents
- (vox-agents/src/envoy/agents: diplomat, negotiator, resolve-negotiator,
- spokesperson), plus briefer sub-agent calls declared via
- modelDependencies, plus envoy context builders (src/envoy/context) and
- wake adapters (VoxContext, buildGameContextMessages) that rebuild each
- prompt. Every one of these is a distinct provider prefix.
- Hook: centralize logging in vox-agents/src/utils/models (models.ts /
- concurrency.ts, where AI SDK requests fan out). Log one JSONL row per
- physical request mirroring runs-siam/telemetry-live.jsonl field names,
- plus agent (which file above initiated it) and prefix_hash (sha of the
- system content + tool schemas for that request, so DISTINCT prefixes per
- turn fall out by counting hashes). Provider cache categories come from
- AI SDK usage + providerMetadata (verify field names for the Spark route
- at implementation time); token-counter.ts covers local estimates only.
- Existing OTel SQLite telemetry (src/instrumentation.ts, utils/telemetry)
- already spans agent executions and can carry the new attributes.
- Runs: 21 cognition opportunities on the SAME model
- (opencode-go/muse-spark-1.3-contributor) post-restart — strategic turns
- plus envoy-handled diplomatic events, same opportunity mix as the pilot
- side. Caveat honestly: game state will have moved past T116-T180, so
- compare per-opportunity shapes (requests, distinct prefixes, summed
- input, hit behavior), not turn-identical values.
- Analysis: sum provider-visible input per opportunity across ALL agents,
- count distinct prefix_hash values per opportunity, then place beside the
- pilot table (1 prefix, ~4.5 requests/turn, ~1.7k fresh + ~212k re-read
- steady-state). The hypothesis predicts the gap scales with fan-out
- times prefix size; the logged rows will show the exact factor.

## Next rows to append

- T207 post-restart bank: expect one ~120k cold start (idle + batched
  prefix re-cache), then steady ~0.99 resumes. Record `wall_gap_sec`.
- Model policy-walk end to end (inspect research/policy `path:` live).
- Portugal seat refresh (stuck at turn 167) for the both-seats-tracked
  requirement.
-
## Structural contrast (source layout; confirm with instrumented runs)

- Pilot: 1 session per civ, 1 persistent prefix. 21 banked turns used 94
  tool calls (~4.5 requests/turn: 61 inspect + 30 commit_turn + 3
  communicate), ALL against the one reused prefix. Commit-only turns are
  a single request; inspect-heavy turns chain follow-ups on the same
  prefix. Steady-state provider-visible input per turn: ~1.7k fresh +
  ~212k re-read.
- Unified Mind (vox-agents source layout): cognition fans out across
  separate agents per turn — strategist variants (src/strategist/agents)
  plus envoy agents (src/envoy/agents: diplomat, negotiator,
  resolve-negotiator, spokesperson), briefers and context builders — each
  invoked with a prompt reconstructed for that wake (VoxContext, wake
  adapters): MULTIPLE distinct prefixes per turn, each paying full
  uncached input.
- The comparison runs must therefore count, per turn: total model
  requests, DISTINCT prefixes, and summed provider-visible input across
  agents — not just per-request hit ratios. The hypothesis predicts the
  pilot wins on all three by roughly the agent-fanout factor times the
  prefix size (~200k+ tokens).
-
## Honest nuance (envoy source read 2026-09-03)

- The Unified Mind side is NOT cache-naive: envoy threads persist
  conversation context (EnvoyThread over a durable store) and use
  provider cache breakpoints (MAX_CACHE_BREAKPOINTS = 4, ephemeral).
- The difference is architectural, not effort: cognition is split across
  SEVERAL prefixes (strategist, diplomat/envoy, negotiator,
  resolve-negotiator, spokesperson, plus briefer sub-agent calls declared
  via modelDependencies), each rebuilt per wake (buildGameContextMessages,
  briefing tools). The pilot keeps ALL of it — strategy, diplomacy,
  deals, grudges — in ONE prefix.
- Refined hypothesis: one stable prefix beats N breakpoint-managed
  prefixes via (a) fewer total prefixes paying uncached input, (b) no
  cross-agent re-grounding (no briefings to re-explain game state to a
  sibling agent), (c) political continuity (the strategist IS the
  diplomat, so no coherence loss at handoffs).
-
## Fork evidence (diplomat312, read 2026-09-03, no code taken)

- Transport convergence: the fork's recovered local-group-chat implements
  group/world chat as broadcast-message + get-global-messages with tagged
  lines — the same transport our 2p channels ride. Independent designs
  converged; our registry/invite/archive layer sits cleanly on top.
- The fork's own cache plan (05.2-cache-aware-envoy-prompt) states the
  problem outright: envoy runs REBUILD the whole conversation into many
  small messages every run, "neither compact nor cacheable", and fixes it
  with a compaction boundary + breakpoint per prefix. The pilot answers
  differently: ONE prefix that is never rebuilt, so there is nothing to
  compact and no boundary to tune. The comparison runs will show which
  answer costs less per turn.
- Pacing (recovered world-chat.js): the fork wakes strategists on letters
  and broadcasts (event-driven, "within a turn or two"). The duel pilot
  stays turn-coupled deliberately: with sequential 2p autoPlay every
  turn is already a cognition opportunity with inbox deltas, so
  between-turn wakes would add requests without adding decisions.
  Adopt later for 3+ civs or real-time tables: a world-beat for
  unprompted speech and a private->WORLD promotion path.
