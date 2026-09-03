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

Known quirks:
- get-players takes a game lock and can hang mid-turn-computation while cheap calls answer in ms. observe.mjs retries 3x10s then fails the turn closed, so no polluted session. Never stack parallel lock probes.
- Probe hygiene: always race with a timeout AND process.exit, else hung fetch sockets linger on the lock.
- opencode run strips OPENCODE password vars in the child env (see driver/session-manager.mjs).
- PowerShell echo writes CRLF; repo files are LF. Write files via node to keep patches matching.
- apply_patch needs bare marker lines.

Watcher: node watch-207.mjs retries turn 207 up to 12 attempts, 4min apart, stops on first banked commit. Create runs-siam/STOP to stop it early.