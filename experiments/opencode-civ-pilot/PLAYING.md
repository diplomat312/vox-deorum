# Playing the 2-player game (Rome harness vs Greece Codex)

Shared world file: runs/2p-game/world.json. Strict alternation: Rome moves first each turn, then Greece. Game advances only when BOTH have moved.

## Who is who

- Rome (Augustus Caesar) = OpenCode harness, persistent session civ-state-Rome.json
- Greece (Alexander) = me (Codex chat), moves applied via apply-move.mjs

## My move (Greece)

1. Read the world (turn, civs.Greece, events, inbox.Greece for unseen Rome messages).
2. Decide actions + rationale + optional reply.
3. Write move file my-move-tN.json with actions, rationale, messageTo, message.
4. Apply: node driver/apply-move.mjs --rundir runs/2p-game --civ Greece --move-file runs/2p-game/my-move-tN.json
5. advanced:true means the turn rolled over; nextUp says whose move.

## Rome move (harness)

Set CIV_PILOT_GAME=2p-1, run driver/run-civ-turn.mjs --rundir runs/2p-game --civ Rome --game 2p-1 --turn N.
Telemetry -> telemetry-2p.jsonl, transcript -> transcript-2p.md.

## Loop

Rome, then Greece, advance, repeat. Scripted events turns 2,3,4,6,8,10. Treasury +7 gold per tick.
