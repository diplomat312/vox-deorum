# opencode-civ-pilot (experiment)

Tests one hypothesis: one persistent, stripped-down OpenCode session can act
as one coherent Civilization V mind, with much better provider prompt-cache
reuse than the current reconstructed Vox-agent prompts.

NOT a port of Vox Deorum to OpenCode. NOT a reproduction of vox-agents.
OpenCode is the cognition/session layer only. Authority stays in Vox:
DLL / Civ V integration, bridge-service, MCP/game-state backend, turn/event
scheduling, pause/resume safety, action legality/validation, replay/telemetry.

## Layout

- `opencode.json` — isolated runtime: pinned model
  `opencode-go/muse-spark-1.3-contributor`, shell/edit/glob/grep/web denied,
  one local MCP server (`vox-civ`), one `civ` agent allowed only the 4 civ tools.
- `agent/civ.md` — static identity text (byte-identical every turn).
- `mcp-server/` — 4 stable tools: `inspect`, `communicate`, `commit_turn`, `pass`.
- `driver/` — session manager (ONE session per civ via `opencode run --session`),
  observation builder (full Turn 1, dashboard+diff after), mock/live backends,
  per-request cache telemetry.
- `runs/` — transcripts + telemetry (gitignored except samples).

## Phases

1. Cognition loop: 1 AI civ, persistent session, inspect -> commit_turn, validated.
2. Persistence/cache: SAME session ~20 turns, per-request cache metrics.
3. Unified politics: one diplo message appended to the SAME session, no diplomat agent.
4. Compare vs current Unified Mind path on cached/uncached input, latency, requests.

## Run

Prereqs: `opencode` CLI logged in (existing user credentials; never committed),
model `opencode-go/muse-spark-1.3-contributor` visible in `opencode models`,
node >= 20. MCP deps install once:

`npm install --prefix mcp-server --no-audit --no-fund`

Single turn:

`node driver/run-turn.mjs --civ Rome --leader "Augustus Caesar" --turn 1 --seq 1 --game smoke-1 --rundir runs/smoke-1`

Full experiment (20 turns, diplo poke at 12):

`node driver/run-experiment.mjs --turns 20 --diplo-at 12 --rundir runs/exp-1`

Resume/continue the same civ session: pass `--session <id>` (printed per turn,
stored in telemetry.jsonl). NEVER start a fresh session per turn — that voids
the cache experiment.

## Cache telemetry

Per request: game, civ, turn, seq, model, session, uncached/cache-read/
cache-write/output/reasoning tokens, latency, tool calls, compaction flag.
`cache_hit_ratio = cache_read / (cache_read + uncached + cache_write)`,
plus cumulative sums. Warming DISABLED for the baseline; log compactions.

## Live-game seam

`driver/vox-backend.mjs` `LiveVoxBackend` is the plug point: route `inspect`
subjects to existing Vox MCP reads (get-players/get-cities/get-events/
get-options/get-victory-progress/get-military-report) and `commit_turn`
actions to set-strategy/set-research/set-policy/set-relationship/
set-production-mode/keep-status-quo (+ deal tools in phase 3).
Mock numbers must never be mistaken for authoritative state.
