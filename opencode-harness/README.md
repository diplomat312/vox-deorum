# opencode-harness

The harness that lets OpenCode model sessions pilot a Civilization V seat. One persistent OpenCode session plays one seat for a whole game, reads its situation through four stable tools, talks to the other seats, and commits a decision. The harness keeps every turn: what the seat was shown, what it thought, what it asked for, what it decided, and what it cost. OpenCode owns the session; Vox Deorum owns the world.

## Playing a simulated game

Nothing here launches Civilization V. A run generates its own game from a seed, so two runs that differ only in how a seat is informed can be played against the same world and compared. Two worlds satisfy the same interface: a generated game, which is what a run plays by default, and a live game reached through Vox Deorum's MCP server.

Build first, then play:

```
npm run build
node dist/run/simulate.js --seats korea,austria,siam,iroquois --from 1 --to 25 --seed 11 --run-id first
```

Options worth knowing:

| Option | What it does |
| --- | --- |
| `--seats` | The seats at the table, comma separated, in turn order. |
| `--from`, `--to` | The turn span to play. |
| `--seed` | The world to generate. The same seed is the same game. |
| `--coaching on` | Closes each observation by stating what dialogue is for. |
| `--posture-coaching on` | Adds a line naming posture as how a relationship is recorded. |
| `--council-coaching on` | Adds a line saying what a council is for. |
| `--briefing on` | Adds a standing summary of contact with each other seat. |
| `--scenario` | A JSON file of circumstances to inject, such as a betrayal or a war. |
| `--turn-timeout` | How long a seat turn may take before it is abandoned. |
| `--run-dir` | Where the run writes. Defaults to `runs/<run-id>`. |

Run artifacts land under the run directory: `trace/` holds one JSONL file per seat, `social/` holds the diplomacy log and the tool call log, and `state/` holds the world snapshot the seats read.

## Reading a run

```
node dist/analysis/report-run.js <run-id>          # writes report.md and report.json
node dist/analysis/compare-runs.js base variant    # baseline first, then variants
node dist/analysis/watch-run.js <run-id>           # tails a run while it plays
node dist/analysis/roundup-run.js <run-id>         # what each seat was thinking across the game
```

The report answers six questions. How much did the seats talk, and who stayed silent. What did each message do, read from its wording, rather than only how many there were. Whether the talking changed anything in the world, counted from the actions the seats actually committed, including the posture changes that record a relationship. What the world recorded, meaning the deals carried out, the promises kept and broken, and the regard the seats actually hold by the end. Whether any relationship lasted, read from how many turns a pair were in contact, how far apart their first and last contact were, and whether the channel was still in use at the end. And what it cost, including the cache hit ratio and the cost per social operation. The comparison puts several runs side by side and lists what changed against the baseline.

## Recorded corpus

The fixtures under `corpus/` come from a recorded four seat game. They calibrate the simulated world and stand as reference for the shape of an observation. Regenerate them from the repository root:

```
node opencode-harness/scripts/harvest-corpus.mjs
```

The harvester reads the source recording through `git show`, so the working tree is left alone and the output is deterministic. From inside the package, `npm run harvest` does the same thing.

## Playing a real game

The same runtime drives a live game through Vox Deorum's MCP server, which must be running with a game in progress. Nothing here launches Civilization V.

```
node dist/run/live.js --seats korea:0,austria:1 --turns 10 --run-id live-first
```

Seats are given as `name:playerIndex` pairs, because a live game is addressed by player index. The run checks the tools it needs before its first turn and names anything missing, and its trace, report and roundup are the same as a simulated run's.

## Playing a seat yourself

Any seat can be played by a person instead of a model. With `--human` naming the seat, the harness offers that seat's turn as files in the seat's own directory and waits for a decision:

```
node dist/run/simulate.js --seats korea,austria --human korea --from 1 --to 10
```

Under `runs/<run-id>/seats/<seat>/`:

| File | Who writes it | What it holds |
| --- | --- | --- |
| `pending-turn.json` | the harness | the briefing, identical to what a model seat reads |
| `decision.json` | you | `{kind: 'commit'|'pass', rationale, actions, operations}` |
| `request.json` | you | `{subject, detail}` for something you want to look up |
| `answer.json` | the harness | the answer to that lookup |

A person's rationale is kept as the seat's reasoning, their messages reach the table, their committed actions reach the world, and their turn appears in the same trace and report as a model's. A UI can drive the same four files later without the runtime learning anything new.

## Tests

```
npm test          # in this package
npm run test:all  # from the repository root
```

Tests live in `tests/mock` and run entirely in process. They never launch Civilization V and never touch the network.

## Plan and findings

The stage order and the requirements behind this package live in [docs/plans/opencode-harness/](../docs/plans/opencode-harness/). What the runs have shown so far is recorded in [FINDINGS.md](FINDINGS.md).

See [AGENTS.md](AGENTS.md) for the component conventions.
