# OpenCode harness

The `opencode-harness` workspace package runs OpenCode model sessions as the cognition layer for Civilization V seats, and measures what they do. It is not part of the shipped game stack: it is the bench where the diplomacy layer is played, watched and tuned, so a change to what a seat is shown can be tried against a game that does not need Civilization V running.

## What it does

One persistent OpenCode session plays one seat for a whole game. The seat reads its situation through four tools, talks and trades with the other seats, and finishes each turn with a commit or a pass. Everything the seat was shown, thought, asked for, decided and cost is written down per turn.

A run generates its own world from a seed rather than replaying a recorded one, so a seat only ever reads a situation its own choices and the other seats' choices produced. Two runs that differ only in how a seat is informed face the same circumstances and can be compared directly. The rates the world runs at are calibrated against a recorded 200 turn game.

Circumstances can be injected on chosen turns, such as a broken promise, a military build-up, a war or a famine, which is how the bench studies a seat's reaction rather than only an undisturbed game.

## Running a game

Build the package, then play:

```
npm --prefix opencode-harness run build
node opencode-harness/dist/run/simulate.js --seats korea,austria,siam,iroquois --from 1 --to 25 --seed 11 --run-id first
```

Useful options include `--coaching on` to close each observation by stating what dialogue is for, `--briefing on` to add a standing summary of contact with each other seat, `--scenario` to inject circumstances from a JSON file, and `--turn-timeout` to bound how long a seat turn may take. Two further toggles name a mechanic a seat may not know how to reach for: `--posture-coaching on` says that a posture action is how a relationship is recorded, and `--council-coaching on` says what a council is for.

One run of a variant is an anecdote. To play a variant several times and get a spread:

```
node opencode-harness/dist/run/matrix.js --variant plain --seeds 11,12,13 --from 1 --to 10
```

Nothing here launches Civilization V, and no test touches a network or a game.

## Reading a run

```
node opencode-harness/dist/analysis/report-run.js <run-id>
node opencode-harness/dist/analysis/compare-runs.js base1 variant1
node opencode-harness/dist/analysis/compare-variants.js plain coached
node opencode-harness/dist/analysis/watch-run.js <run-id>
```

The report answers five questions. How much did the seats talk, and who stayed silent. What did each message do, read from its wording, rather than only how many there were: ceremony, information, a proposal, a commitment, a demand, a question, an accusation, an apology, or a leak of the machinery. Whether the talking changed anything in the world, counted from the actions the seats actually committed, including the posture changes that record how a seat regards another. What the world recorded by the end, meaning the deals carried out, the promises still being paid and the ones broken, the wars declared, and the coldest regard one seat holds toward another. And what it all cost, including the prompt cache hit ratio and the cost per social operation. The comparison places runs side by side and lists what changed against the baseline. Comparing variants puts the summaries of replicated variants together and marks a difference as a result only when the ranges do not overlap. The watcher tails a run while it plays, and the roundup reconstructs what each seat was thinking across the game, keeping the sentence each reading came from.

A run writes under `opencode-harness/runs/<run-id>`: `trace/` holds one JSONL file per seat, `social/` holds the diplomacy log and the tool call log, and `state/` holds the world snapshot the seats read.

## What it has shown so far

[FINDINGS.md](../../opencode-harness/FINDINGS.md) records the hypotheses tested, the evidence for each, and what each result implies for the next change to the diplomacy layer.

## Relationship to Vox Agents

The unified civilization mind in `vox-agents` is the previous approach to a model-driven seat and is now legacy. The harness treats OpenCode as the session layer, and Vox stays authoritative for game integration, action validation and replay. In a live game a seat's reads and writes go through the same MCP tools and bridge every other caller uses; the simulated bench replaces only the state source.
