Live duel runbook (game live-duel).

Seats: Portugal seat 0 (Maria I, Codex-played) vs Siam seat 1 (Ramkhamhaeng, OpenCode harness).
Siam session ses_f9a74a908ffeMXPkF3Y5Bh37Ba, model opencode-go/muse-spark-1.3-contributor. One session per civ, always.

Backend: MCP 127.0.0.1:4000, bridge 5000, dashboard 5555. Civ V stays rendered. Never restart services under a watched game.

Siam turn (PowerShell, detached, poll FILES not sessions):
    cd live
    Start-Process node with single-quoted args: run-live-turn.mjs --turn N --rundir ABS-PATH(live/runs-siam) --game live-duel
    then poll runs-siam telemetry-live.jsonl and transcript-live.md
Rundir must be ABSOLUTE. Redirect console and error to files.

Portugal observation: node observe-seat.mjs --player 0 --turn N --since M. Same builder as the harness.

Prefix guard: node check-prefix.mjs (fail means a model-visible change). Re-baseline only after a deliberate batched change with --update.
Model-visible prefix: agent/civ.md plus opencode.json plus vox-civ tool schemas. Dashboard text and inspect results are suffix and freely tunable.

Channels: registry live/channels.json. Create with channels.mjs createGroup, invite with inviteToGroup. 2p groups ride world broadcast as tagged lines. Send via communicate channel group:ID. Backpressure: one send per turn TOTAL.
Duel Hall group c53f2974 (Portugal plus Siam, opened T207).
Close finished channels with channels.mjs archiveGroup (active members only; archived groups vanish from inbox and reject later sends with 'unknown group').

Inspect walkers (suffix-only, no prefix cost): research/policies accept a name
or 'path:<name>' (full prereq chain with costs and unlocks); military accepts
'zone:<city or zone>' or 'stats' (zone lines also carry posture + zone value);
cities accepts a city name; diplomacy accepts a civilization name and the
no-detail view now includes a city-state table (status + quest count).
Model-facing channels: world | private (default) | dm:<seat> | group:<id> |
group:create:<title>. Prefix re-baselined 2026-09-03 for the batched
description + civ.md update (one deliberate re-cache while cold).

Known quirks:
- get-players takes a game lock and can hang mid-turn-computation while cheap calls answer in ms. observe.mjs retries 3x10s then fails the turn closed, so no polluted session. Never stack parallel lock probes.
- Probe hygiene: always race with a timeout AND process.exit, else hung fetch sockets linger on the lock.
- opencode run strips OPENCODE password vars in the child env (see driver/session-manager.mjs).
- PowerShell echo writes CRLF; repo files are LF. Write files via node to keep patches matching.
- apply_patch needs bare marker lines.
- Session leanness is verified, not assumed: opencode export shows only
- vox-civ_* tool calls and zero plugin/MCP/skill leakage into context.
- Offline spawns (check-prefix.mjs, test-channels.mjs routing section) can
- fail with spawn UNKNOWN while a watcher attempt is in flight (run-live-turn
- holds opencode plus MCP children); retry in the ~3min quiet gap between
- attempts. Contention, not breakage: 26/26 green off-window.
- attempts. Contention, not breakage: suite green off-window (30/30).

Watcher: node watch-207.mjs retries turn 207 up to 100 attempts, 4min apart (about 8h coverage, full overnight), stops on first banked commit. Create runs-siam/STOP to stop it early. The watcher is our own file-polling loop — restarting it never touches game services.

Recovery — wedged game lock (get-players hangs, cheap calls answer, Civ V
alive and accruing CPU, dashboard shows the turn not advancing):
1. Confirm the wedge: watch-207.log repeats exit=1 commit=false on ~40s
   attempts; dashboard status reads running, unpaused, autoPlay on, stock
   minds off.
2. Capture before touching anything: tail of watch-207.log,
   telemetry-live.jsonl, civ-state-siam.json, civ-state-portugal.json, and
   the node/Civ PIDs with CPU (baseline 2026-09-03: node 41744/1884 hot
   since 8:57pm — one may be spinning on the stuck lock).
3. Restart services (morning call, never unattended): bridge-service (:5000,
   starts first) then mcp-server (:4000). Leave Civ V rendered; never start
   a second game under a watched game.
4. Verify with ONE cheap call, then ONE get-players with a timeout — never
   stack parallel lock probes. When it answers, the watcher banks turn 207
   on its next attempt; do not run a manual turn in parallel.
5. After the bank: record the fresh cache numbers (expect one ~120k cold
   start after the idle plus the batched prefix re-cache), run the model
   policy-walk end to end, refresh the Portugal seat file, then phase-4.
