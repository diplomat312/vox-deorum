# Playing through the OpenCode civ harness

One persistent OpenCode session per civilization. That session is the mind:
strategy, diplomacy, deals, and chatter all flow through the same continuity.

## The two backends (one schema)

Both MCP front doors expose the same four tools from driver/civ-tools.mjs:
inspect, communicate, commit_turn, pass. They differ only behind the tools.

- Mock (mcp-server/index.mjs): reads a world JSON file, answers inspect from
  the snapshot, logs speech to the world inbox. Every inspect answer carries
  backend "mock (no live game)" so test data is never mistaken for the game.
  For offline drills and routing tests only.
- Live (live/vox-live-server.mjs): reads the real game through the Vox MCP
  and posts speech through Vox broadcast plus the channels registry. Game
  state authority stays in Vox. This server never writes game state.

The model cannot tell which backend it talks to from the schemas, and that
is the point. Promotion from mock drills to the live game changes no prefix.

## A turn

1. The driver (live/run-live-seat.mjs picks the seat config, then
   live/run-live-turn.mjs runs it) builds a small observation: dashboard,
   changes since lastSeenTurn, outstanding messages and deals.
2. It appends the observation to the civ session and waits for commit_turn
   (or pass). One nudge follow-up fires when the session ends the turn
   without committing.
3. Committed actions apply through Vox MCP tools, each validated. The seat
   state file advances lastSeenTurn only on a committed turn, so a failed
   turn keeps its horizon and its events stay visible next opportunity.
4. The process exit code is 0 only on commit_ok, so watchers can tell a
   banked turn from a retry.

## Talking

One send per turn total across all channels, enforced server side by
checkSend plus a guard file keyed by turn (live/channels.mjs). The channel
forms ride the stable communicate schema: world, private, dm, group id,
group create, invite, accept, decline, leave, archive. Invites resolve through
resolveInvite, so accepting or declining a group is explicit, never a side
effect of sending.

## Deals

Deal propose, accept, and reject are first class commit_turn actions, mapped
onto the Vox deal tools (proposal message, enact, reject) with legality
checked by Vox. Check inspect(deals) before proposing.

## Live operations

Live duel runbook, watcher usage, prefix guard, and lock contention notes:
live/RUNBOOK.md. Telemetry lands in each seat rundir as telemetry-live.jsonl
with per-request cache counters; transcripts append to transcript-live.md.
