# OpenCode Harness: Build Order

This folder holds the feature that makes OpenCode the harness that pilots a Civilization V seat. The requirements live in [specs.md](specs.md); this page fixes the stages, their order, and what is true at the end of each one.

Each stage is independently verifiable and ships on its own. Simulation before live play, and measurement before optimization: the tuning loop in Stage 5 has nothing to tune until Stages 1 through 4 produce a run and a trace store.

| # | Stage | What is true at the end |
| --- | --- | --- |
| 1 | Corpus and replay world | A recorded game replays deterministically, and the harness can ask for the observation and world facts at any turn and seat. |
| 2 | OpenCode session client | The harness can hold one persistent OpenCode session per seat, send it an observation, and capture reasoning, tool calls, usage and cost. |
| 3 | Seat runtime and trace store | A seat runs a turn end to end against the simulation, with its four tools wired, and every step lands in the trace store. |
| 4 | First simulated benchmark | Several seats play a recorded window together against a live diplomacy layer, and the run produces metrics and artifacts. |
| 5 | Analysis, roundup and tuning | Reasoning can be read back per seat and turn, roundups reconstruct intentions, and variants are compared on the richness, stability and cost frontier. |
| 6 | Live path | The same seat runtime drives a real game through Vox MCP and the bridge, with the pacing policy and backend supervision. |
| 7 | Human seat and interface | A person plays one seat in the same game, and a usable interface shows the seats, the politics and the traces. |

## Stage 1: Corpus and replay world

Turn the recorded game into a fixture and build the loader that serves it.

The recording is a four-seat game captured on another branch: per-turn observations, every tool call with its result, epoch records, and per-request telemetry. Extraction produces one file per seat, one record per turn, holding the observation exactly as it was sent and the calls that followed it. The extraction script reads from the git object store rather than a checkout, is deterministic, and reports coverage per seat so gaps are visible.

The world interface is deliberately small, because it is what a later live implementation must also satisfy: give me the seats in a game, give me the observation for a seat at a turn, and give me the world facts behind it. The replay implementation answers from the fixture. A synthetic implementation answers from a hand-written scenario, which is what the unit tests use so they never depend on the recording.

Done when a test can replay a chosen window and read back an observation identical to the one the recording holds, and the extraction reports clean coverage.

## Stage 2: OpenCode session client

Own the conversation with the model.

The client talks to the OpenCode server rather than the run command, for the reasons in the specification. It starts or attaches to a server, creates one session per seat and keeps it for the game, and sends an observation as a message. It reads back the response as parts, so reasoning, visible text and tool calls are separated and each is preserved. It records the usage attached to each message, which includes cache reads and writes, reasoning tokens, latency and cost.

The seat's runtime environment is part of this stage, because a seat must not be able to touch the repository or the shell: the session runs under a configuration that denies every tool except the four civ tools, in a per-seat working directory.

Done when a mock server exercises the client in tests, and one live smoke call against a real session returns a reasoning part and a cost figure.

## Stage 3: Seat runtime and trace store

Make one seat run one turn.

This is where the four tools stop being abstractions. Reading goes to the world. Speaking and dealing go to the diplomacy layer and have real consequences inside the run. Committing and passing end the turn and record the decision. The observation is assembled the same way it was in the recording, so the same information reaches the model, and the assembly is a single function that later stages can vary on purpose.

Everything the turn touched is written to the trace store in one place: the observation, the reasoning, the calls, the decision, the outcome, and the usage numbers. The store is the interface for every later question and for the benchmark metrics, so it is designed before it is needed rather than after.

Done when a single seat can play a stretch of recorded turns through the simulation and a reader can reconstruct any one of those turns from the store alone.

## Stage 4: First simulated benchmark

Put several seats in one run.

A run holds several seats in one session set, all playing the same replayed world with a shared diplomacy layer, so messages arrive, groups form, and deals are proposed and answered. The seats cannot see each other's private reasoning, only what they say and do.

The run emits metrics that match the two goals: richness, measured through message volume and depth, who initiates contact, group formation, deal attempts and outcomes, and how relationships move; and cost and stability, measured through tokens, cache reuse, latency, spend, failures and refusals. Artifacts are published with the run so a result can be inspected without replaying it.

Done when a recorded window plays to its end with more than two seats, and the run produces both a comparison against the recording and a metrics report.

## Stage 5: Analysis, roundup and tuning

Turn the trace store into the two products it exists for.

The inspector answers what one seat knew, reasoned and did at one turn. The roundup reads a whole game and reconstructs a seat's intentions over time, which is what makes a finished game worth writing up.

The tuning loop is the reason a simulation exists at all: define a variant, which is a change to what is presented, how it is worded, or how a prompt is framed, run it against the same recorded window, and compare it on the richness, stability and cost frontier. The output is evidence about which presentation of information produces better diplomacy per unit of cost, and it feeds back into the observation builder and the tool descriptions.

Done when two variants have been run and compared, and the comparison is good enough to justify a change.

## Stage 6: Live path

Point the same runtime at a real game.

The seat runtime does not change. What changes is the world implementation, which now reads live state through Vox MCP and the bridge, and the pacing policy, which becomes the overlap window with revalidated commits. Backend supervision, health checks and outage handling move from desirable to required, because a live game keeps running whether the backend is healthy or not.

Done when seats play a live game unattended for a long stretch, recover from a backend restart, and publish a trace.

## Stage 7: Human seat and interface

Let a person play.

One seat in the same game belongs to a human, who sees the same information a model seat sees and acts through the same tools. The interface shows the table, the politics as they happen, and the reasoning behind a decision, which is the same trace store read through a different lens.

Done when a person can take a seat, negotiate with the model seats, and finish a session.
