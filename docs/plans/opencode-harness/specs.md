# OpenCode Harness

> This plan makes OpenCode the model-agnostic harness that pilots a Civilization V seat. The harness runs one persistent OpenCode session per seat, shows that seat its situation through a small stable tool surface, records everything the seat was shown, reasoned and decided, and moves the game forward. The staged build order lives in [README.md](README.md).

## Summary

Vox Deorum already owns the hard parts of talking to Civilization V: the DLL, the bridge service, the MCP server with its validated action tools, the game databases and the telemetry pipeline. What it has never had is a cognition layer a model can live inside for a whole game. The unified civilization mind reconstructs a prompt from scratch every turn and is now a stale approach.

The harness replaces that approach. One OpenCode session is persistent for the length of a game, so a seat's identity, its history and its provider-side prompt cache survive from turn to turn. The seat sees its situation as a rendered observation, asks for more with one read tool, speaks and trades with one social tool, and finishes with a commit or a pass. Everything else, meaning unit movement, city production, combat and the whole tactical layer, stays with the native game AI. The model owns strategy and diplomacy.

Development and tuning happen against a simulated game, not a live one. A run generates its own world from a seed, so two runs that differ only in how a seat is informed face identical circumstances and can be compared without argument.

## What done looks like

- Several OpenCode seats play a long game autonomously against each other, with the native AI executing everything delegated to it.
- Public and private diplomacy is rich and emergent: world broadcasts, direct messages, groups, negotiated deals, posture, and war and peace decisions, with commitments made in one turn visibly shaping reasoning dozens of turns later.
- A human can join the same game in one seat.
- For any seat and any turn, we can see the exact information handed to the model, the model's reasoning, every tool call and its result, the decision, the outcome, and the token, cache, latency and cost numbers.
- A post-game roundup can reconstruct what a rival was thinking and when, well enough to be worth reading.
- Runs are cheap and stable enough to leave unattended for hundreds of turns.

## Scope boundaries

The unified civilization mind is a previous approach. It stays in the repository as a legacy cognition backend a player can still select, but the harness does not depend on it and does not extend it.

The model-facing capability surface does not grow by adding tools. The four tools the seat has today, meaning inspect, communicate, commit_turn and pass, are the surface. New abilities arrive as new verbs inside those tools, which is how negotiated deals were added: three further social operations rather than a fifth tool.

The harness does not open a second door into the game. In a live game, reads and writes reach Civilization V through the same bridge and MCP tools every other caller uses, so legality, validation and logging stay in one place.

## Architecture

| Piece | Responsibility |
| --- | --- |
| Seat runtime | Runs one seat for a whole game: builds the observation, invokes the model, applies the decision, records the trace. |
| Session client | Owns the OpenCode server connection and one persistent session per seat. |
| Tool surface | The four tools a seat may call, exposed over MCP to the session and served in process by tests. |
| World | Supplies the state a seat reads. A simulated game, a recorded game and, later, a live game all satisfy the same interface. |
| Authority layer | Vox MCP action tools for validated writes and the bridge for live reads. |
| Trace store | Per turn and per seat: the observation, the reasoning, the calls, the decision, the outcome and the usage numbers. |
| Analysis | Reports, comparisons, a live watcher and roundups over the trace store, for both drama and tuning. |

## Locked decisions

OpenCode is the session layer, and Vox stays authoritative. The harness never invents game state and never applies an unvalidated change.

The harness talks to the OpenCode server API rather than the run command. Every invocation of the run command on this machine fails with a session error, including with a minimal configuration and a freshly migrated database, while the server starts and answers normally. The server API also returns strictly more: a turn's messages include the model's reasoning text alongside its answers and tool calls, and each message carries cache read and write counts, reasoning tokens and a cost figure. That is the information this project exists to collect.

Reasoning is captured and stored. It is the raw material for both the inspection platform and the tuning loop, so it is first-class output rather than a debug artifact.

A turn is read from every message it produced, not from the reply to the request. A turn that uses tools is several messages, and the reply carries only the closing one, so reading that alone reports a turn in which the model did nothing.

Simulation comes before live play. Nothing in the development loop launches Civilization V.

A seat's prompt cache is worth protecting. Recovery prefers clearing stalled work over replacing a session, because replacing it destroys the cache the project exists to measure and the seat's memory of the game.

The harness is a first-class component with its own workspace package, mock-tier tests, a CI job and a documentation page.

## The simulation environment

A run generates its own game. Named rates set how fast cities grow, how fast research and policies accumulate, how gold and military strength move, and when a seat founds its next city. The rates are calibrated against a recorded 200 turn game rather than guessed, and the recording is kept as the reference for what the real game produced.

Inside a run the whole world is live, not replayed. A seat only ever reads a situation its own choices and the other seats' choices actually produced, which is what makes the diplomacy causal rather than decorative. The seats' own decisions move the world: research changes the technology line, a posture action changes how a seat is regarded, and an agreed deal moves gold.

Circumstances can be injected on chosen turns: a broken promise, a military build-up, a windfall, a leap in knowledge, a war, a peace, a new city or a famine. This is what the environment exists for, because a seat's ordinary turn is less interesting than its reaction to a betrayal or a build-up. Injected circumstances reach the seats as news in the same voice as everything else.

Because the world is seeded, the seats are the variable. A variant run is directly comparable to the run it is measured against.

## Observability

The trace store is the centre of the design, because inspection and tuning are questions asked of it.

- Shown: the exact observation the seat received, with every section intact.
- Thought: the reasoning text, when the provider emits it, kept per turn.
- Did: every tool call with its arguments and result, the terminal decision, and what the world did with it.
- Cost: input, output, reasoning, cache read and cache write tokens, cache hit ratio, latency and cost, per call, per seat and per run.
- Politics: who spoke to whom and when, when groups formed, which deals were proposed and how they were answered, and how relationships moved.

From that store three products follow. The report answers what a run cost and how much the seats talked. The comparison places runs side by side and lists what changed. The roundup reconstructs a long arc from one seat's reasoning across a game.

## Pacing

Where a seat thinks relative to the game clock is the one structural choice that trades coherence against throughput.

Holding the game frozen for the whole thought guarantees a seat acts on exactly the state it saw, at the cost of stalling the world for the entire thinking time of every seat on every turn.

Letting the game run while the seat thinks and pausing only at the commit keeps throughput and keeps a human seat playable, but a decision can land against a state that has moved, so commits must be revalidated. Never pausing is cheapest and drifts furthest.

The harness separates the decision from the commit and states the window policy explicitly, so this choice can change without anything upstream of it changing. The simulation is not paced at all, because the clock is ours; the live path uses the overlap window with revalidated commits.

## Cost and stability

A run carries a budget ceiling that the harness enforces, so an autonomous experiment cannot run away.

Seats run on the opencode-go provider with deepseek-v4.1-flash by default, configurable per seat so mixed rosters are possible later.

Every call has a deadline shorter than the socket layer's own, so the harness notices a stall before the transport does and can act on it. A stalled call blocks its session's queue, so clearing it is what keeps one slow turn from costing the turns after it.

A seat that cannot start sits the run out rather than taking the run down with it, and the summary names it. Supervision is part of the harness because the recorded 200 turn game ended when its backend exhausted its heap with no cap, no supervisor and no health probe.

## Verification

Mock-tier tests cover the world, the corpus loader, the session client, the tool surface, the seat runtime, the trace store, the social store, the MCP server and the analysis tools. No test touches a network or a game.

A simulation smoke test drives seats end to end against a generated world and asserts that reasoning, usage and decisions all reach the trace store.

The package is part of the root test, lint and typecheck runs, and CI typechecks it beside the other services.

An acceptance run publishes its artifacts for review: the trace, the report and the comparison.
