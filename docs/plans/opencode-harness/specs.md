# OpenCode Harness

> This plan makes OpenCode the model-agnostic harness that pilots a Civilization V seat. The harness runs one persistent OpenCode session per seat, shows that seat its situation through a small stable tool surface, records everything the seat was shown, reasoned and decided, and moves the game forward. The staged build order lives in [README.md](README.md).

## Summary

Vox Deorum already owns the hard parts of talking to Civilization V: the DLL, the bridge service, the MCP server with its validated action tools, the game databases, and the telemetry pipeline. What it has never had is a cognition layer that a model can live inside for a whole game. The current attempt, the unified civilization mind, reconstructs a prompt from scratch on every turn and is now a stale approach.

The harness replaces that approach. An OpenCode session is persistent for the length of a game, so a seat's identity, its history, and its provider-side prompt cache all survive from turn to turn. The seat sees its situation as a rendered observation, asks for more with one read tool, speaks with one social tool, and finishes with a commit or a pass. Everything else, meaning unit movement, city production, combat and the whole tactical layer, stays with the native game AI. The model owns strategy and diplomacy.

Development and tuning happen against recorded games rather than a live one. A recorded game gives a fixed material trajectory and a real observation stream, so a prompt or information change can be measured against the same situations, multiple times, at no game cost.

## What done looks like

- Several OpenCode seats play a long game autonomously against each other, with the native AI executing everything delegated to it.
- Public and private diplomacy is rich and emergent: world broadcasts, direct messages, group formation, negotiated deals, posture, and war and peace decisions, with commitments made in one turn visibly shaping reasoning dozens of turns later.
- A human can join the same game in one seat.
- For any seat and any turn, we can see the exact information handed to the model, the model's reasoning, every tool call and its result, the decision, the outcome, and the token, cache, latency and cost numbers.
- A post-game roundup can reconstruct what a rival was thinking and when, well enough to be worth reading.
- Runs are cheap and stable enough to leave unattended for hundreds of turns.

## Scope boundaries

The unified civilization mind is a previous approach. It stays in the repository as a legacy cognition backend that a player can still select, but the harness does not depend on it and does not extend it.

The model-facing capability surface does not grow in this work. The four tools the seat has today, meaning inspect, communicate, commit_turn and pass, are the surface. Tuning happens in what information is presented, how it is worded, how much of it is presented, and how the prompt frames it. Adding a new ability for the model is a separate decision made later.

The harness does not open a second door into the game. Reads and writes reach Civilization V through the same bridge and MCP tools every other caller uses, so legality, validation and logging stay in one place.

## Architecture

| Piece | Responsibility |
| --- | --- |
| Seat runtime | Runs one seat for a whole game: builds the observation, invokes the model, applies the decision, records the trace. |
| Session client | Owns the OpenCode server connection and one persistent session per seat. |
| Tool surface | The four tools the seat is allowed to call, exposed over MCP: inspect, communicate, commit_turn, pass. |
| World | Supplies the state the seat reads. A recorded-game replay in simulation, the live game in play. |
| Authority layer | Vox MCP action tools for validated writes and the bridge for live reads. |
| Trace store | Per turn and per seat: the observation, the reasoning, the calls, the decision, the outcome and the usage numbers. |
| Analysis | Queries and roundups over the trace store, for both drama and tuning. |

## Locked decisions

OpenCode is the session layer, and Vox stays authoritative. The harness never invents game state and never applies an unvalidated change.

The harness talks to the OpenCode server API rather than the run command. As of this writing, every invocation of the run command on this machine fails with a session error, including with a minimal configuration and a freshly migrated database, while the server starts and answers normally. The server API also returns strictly more: the response parts include the model's reasoning text alongside the final answer, and each message carries cache read and write counts, reasoning tokens and a cost figure. That is the information this project exists to collect, so the CLI is not a viable seam even once it works again.

Reasoning is captured and stored. It is the raw material for both the inspection platform and the tuning loop, so it is treated as first-class output rather than a debug artifact.

Simulation comes before live play. Nothing in the development loop launches Civilization V.

The recorded world is fixed and the seats are the variable. A variant run is comparable to the recording it replays.

The harness is a first-class component with its own workspace package, mock-tier tests, a CI job and a documentation page.

## The simulation environment

The state source is a recorded game. The first one is a four-seat, two-hundred-plus-turn game whose complete observation stream, tool calls, epoch records, per-request telemetry and transcripts were captured. The corpus extraction turns that recording into a fixture that the harness can replay deterministically.

Inside a run, the material world follows the recording: cities, technology, gold, units and map position move as they did, so two variants face the same situations. The diplomacy layer is live and has real consequences within the run. Messages are delivered, groups form and dissolve, deals are proposed and accepted or refused, posture shifts, and those events feed the seats' later observations exactly as they would in a real game. That is the layer under test, and it is the one where emergent behaviour can actually appear.

Because the material world is replayed, a variant run can be compared against the recording turn by turn, which turns "does this prompt change help" into a measurement rather than an impression.

## Observability

The trace store is the centre of the design, because two of the three goals in this project, inspection and tuning, are questions asked of it.

- Shown: the exact observation the seat received, with every section intact and every truncation marked.
- Thought: the reasoning text, when the provider emits it, kept per turn.
- Did: every tool call with its arguments and result, the terminal decision, and what the game or the simulation did with it.
- Cost: input, output, reasoning, cache read and cache write tokens, cache hit ratio, latency, and cost, per call, per seat and per run.
- Politics: who spoke to whom and when, when groups formed, which deals were proposed, and how relationships moved.

From that store two products follow. The inspector answers "what did this seat know, think and do at this turn", and the roundup reconstructs a long arc from one seat's reasoning across a game.

## Pacing

Where a seat thinks relative to the game clock is the one structural choice that trades coherence against throughput, so it is worth stating plainly.

Holding the game frozen for the whole thought guarantees that a seat acts on exactly the state it saw, and it is the simplest thing to reason about. It also stalls the world for the entire thinking time of every seat on every turn, which makes a long game slow and would make a human seat unpleasant to sit through.

Letting the game run while the seat thinks and pausing only at the commit keeps throughput and keeps a human seat playable, but the decision can land against a state that has moved, so commits must be revalidated and a decision can be invalidated before it lands.

Never pausing is cheapest and drifts furthest from the state a decision was based on.

The harness therefore separates the decision from the commit and states the window policy explicitly, so this choice can change without anything upstream of it changing. The recommended split is the strict, state-faithful window in simulation, where the clock is ours anyway, and the overlap window with revalidated commits in live play.

## Cost and stability

A run carries a budget ceiling that the harness enforces, so an autonomous experiment cannot run away.

Seats run on the opencode-go provider with deepseek-v4.1-flash by default, configurable per seat so mixed rosters are possible later.

Supervision is part of the harness rather than an afterthought, because the recorded two-hundred-turn game ended when the MCP server exhausted its heap at roughly four gigabytes with no cap, no supervisor and no health probe. The harness watches backend health, survives a restart, and refuses rather than free-running when the backend is gone.

## Verification

Mock-tier unit tests cover the session client, the corpus loader, the observation builder, the decision application and the trace store, with no network and no game.

A replay smoke test drives a short recorded window end to end against the simulation and asserts that reasoning, usage and decisions all reach the trace store.

A CI job runs the harness suite beside the existing ones.

A full-game acceptance run publishes its artifacts for review.
