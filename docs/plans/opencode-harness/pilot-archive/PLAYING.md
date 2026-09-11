# Playing through the OpenCode civ harness

One persistent OpenCode session per civilization. That session is the mind:
strategy, diplomacy, deals, and chatter all flow through the same continuity.

## Seats

Seats are stable harness ids in live/social-seats.json (seat, civ, leader,
playedBy, playerID once the game assigns them). driver/seats.mjs is the one
resolver everywhere: numbers, civ names, and leader names all resolve to a
seat, and seatPlayer maps seats to Vox player ids. No RIVAL_ID semantics
remain: every counterparty is explicit.

## The two backends (one schema, one executor)

Both MCP front doors expose the same four tools from driver/civ-tools.mjs.
All communicate operations run through driver/social-exec.mjs on every
backend and the dashboard: parsing, validation, membership, and budget are
identical, only the delivery differs (Vox broadcast and pair threads live,
world-file log and inbox in mock drills).

Mock inspect answers carry an explicit mock flag plus the world-file path
it tried, so test data is never mistaken for the game.

## Talking: batched operations with a budget

One communicate call carries operations:[{channel, target?, message}], up
to 8 per seat per turn (CIV_PILOT_OPS_BUDGET). Validation failures are free;
delivered operations spend, including silent ones like declining an invite.
The legacy single form still works as one operation. Budget state lives in
one shared ops-budget.json keyed (seat, turn), enforced identically on mock,
live, and dashboard paths (humans post turn-free and never spend a seat budget).

## Privacy model

World posts broadcast publicly. DMs and private letters go to exactly one
pair thread. Group traffic fans out to member pair threads only, never the
world channel. Invites are explicit: an invited seat must accept before it
can send, and fan-out includes invitees so a new member thread holds the
room history from the invite onward. Reads are registry-gated (groupInbox),
so even a leaked tag stays invisible to non-members.

## Deals

Deal propose names its counterparty through the items (bilateral only; Vox
validates legality). Accept enacts by proposal id. Reject finds the proposal
thread by id across your pairs. inspect(deals) takes a counterparty seat,
and inspect(diplomacy, correspondence:<seat>) returns the full pair history.

## A turn

1. The seat driver builds a small observation: dashboard, changes since
   lastSeenTurn, outstanding messages and deals across all peers.
2. It appends the observation to the civ session and waits for commit_turn
   (or pass), with one nudge follow-up when the session ends without one.
3. Committed actions apply through Vox MCP tools, each validated. Seat state
   advances lastSeenTurn only on a committed turn. Exit code is 0 only on
   commit_ok.

## Humans

The dashboard Social tab speaks through the same executor. Writes need the
seat secret (live/seats-secrets.json, never committed); the observer seat
(-1) posts world-only and is Vox-labeled natively. Human posts never spend
harness budgets and land in harness observations on the next turn.

## Telemetry

Per-request cache counters land in each seat rundir as telemetry-live.jsonl.
driver/rollup.mjs aggregates turns, commits, tokens, hit ratio, latency, and
social operations per seat and total.
Each supervisor turn appends a decision-epoch record (runs-<civ>/epochs.jsonl):
trigger turns, collapsed epochs, exit, committed turn, paused and cognition
milliseconds. Telemetry carries trigger_turn and horizon before/after, so any
collapsed decision epoch is provable, not inferred. Provider cost is not exposed, so cost
stays an explicit gap.

## Booting a fresh game

Scripted starts stall on turn 0 with slot 0 waiting on the local human. After
the DLL connects, enable engine AI autoplay through lua-executor:
Game.SetPausePlayer(-1); Game.SetAIAutoPlay(1000, -1). Watch activePlayerId
move and the turn leave 0 before standing up seats.

## Live operations

Watchers, prefix guard, and lock notes: live/RUNBOOK.md. Offline suite:
live/test-channels.mjs (channels, routing, budget, mock/live parity, seat
keys, visibility) and live/test-fourway.mjs (batch budget, same-turn seats,
DM and group privacy, next-turn views).

## Seat-turn gating and durable cognition state

Each seat loop wakes only for its own native turn: an SSE event naming its
player, or the cheap status poll showing it is the active player. After
pausing it re-checks the active player and refuses (logged refused epoch)
on mismatch. Epochs record gameTurn, expected/trigger/active player ids,
and the wake source. While one cognition runs, only genuinely newer turns
queue, deduplicated; collapsed means newer triggers coalesced, nothing else.

Per-seat cognition-state.json survives supervisor restarts
(lastSuccessfulDecisionTurn plus pending turn/status). A restart retries the
pending turn when the game has not moved past it, otherwise records an
explicit missed_epoch. No failed or interrupted decision is silently dropped.
Pause holds are per cognition only: pre-arming auto-pause at loop boot was
tried and reverted after it froze a fresh game start. Holds do not reliably
gate mid-game turns, so missed turns stay possible and explicitly recorded.

Every model-facing tool call lands in the seat rundir tool-calls.jsonl with
timestamp, seat, turn, arguments, outcome, and duration, and the turn
transcript Tool calls section carries the same arguments and results.
