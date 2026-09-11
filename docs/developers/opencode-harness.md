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

Useful options include `--coaching on` to close each observation by stating what dialogue is for, `--briefing on` to add a standing summary of contact with each other seat, `--scenario` to inject circumstances from a JSON file, and `--turn-timeout` to bound how long a seat turn may take. Three further toggles name a mechanic a seat may not know how to reach for: `--posture-coaching on` says that a posture action is how a relationship is recorded, `--council-coaching on` says what a council is for, and `--strategy-coaching on` says that a grand strategy is something a seat can declare.

One run of a variant is an anecdote. To play a variant several times and get a spread:

```
node opencode-harness/dist/run/matrix.js --variant plain --seeds 11,12,13 --from 1 --to 10
```

Nothing here launches Civilization V, and no test touches a network or a game.

## Playing a live run without the game

The live path reaches a real game through Vox Deorum's MCP server, which is the one part of the harness that cannot be covered by a fake connection: in a live run each seat reaches the game through its own tool server, in its own process. A stand-in game speaks that same protocol on the same transport, so a whole live run can be played, paced and read with no game installed:

```
node opencode-harness/dist/run/fake-game.js --port 4000
node opencode-harness/dist/run/live.js --seats korea:0,austria:1 --turns 2 --run-id standin
```

The stand-in holds a turn clock that really moves and really holds, players whose reads change when their writes land, a transcript with real message ids, and deals that validate before they enact. It is not a simulation of Civilization V and does not aim to be: it exists so the live path can be exercised rather than assumed. Point it at another address with `--port`, and point a run anywhere with `--mcp`.

## What a seat is actually given

A seat's session inherits the machine's own OpenCode configuration as well as the one the harness writes, so a seat was being offered the operator's other MCP servers along with its own. The written configuration now switches those off by name, and every run asks each seat's session what servers it holds:

- A seat whose own game tools are missing or not connected refuses to start, because it would otherwise play a whole game with nothing to call and be recorded as a seat that chose to say nothing.
- A seat that can still reach a server it has no business using is reported in the run log.

The check is one read of the session's server list, so it costs nothing and catches the failure that hides itself.

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

A deal is the one social operation a live game has a better place for than the run's own log, so it goes to the game's deal system: the terms are written to the pair's transcript, the other seat answers the proposal by its message id, and acceptance enacts the trade in one game action. The bench has no such system, so it settles deals in its own social log instead. Either way the seat answers an offer by the id it was given.

A live seat's own tool server reads the game rather than a snapshot of it. It is given its table and the game's address, builds the same live world the harness uses, and answers the seat's inspects from the game, so a seat's reads, its messages and its deals all go where every other caller's do.

A live turn also carries what the other seats said. A game has a place for a deal and none for ordinary diplomacy, so a message is kept in the run's own log and read back at the start of the seat's next turn, in the same sections the generated world uses: the messages a seat has not seen, and the councils it belongs to or has been invited to. Both a generated and a live game therefore show a seat the same shape, which is what lets a seat that has played one read the other.
