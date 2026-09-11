# OpenCode Harness: Build Order

This folder holds the feature that makes OpenCode the harness that pilots a Civilization V seat. The requirements live in [specs.md](specs.md); this page fixes the stages, their order, and what is true at the end of each one. What the runs have actually shown is recorded in [FINDINGS.md](../../../opencode-harness/FINDINGS.md).

Each stage is independently verifiable and ships on its own. Simulation before live play, and measurement before optimization.

| # | Stage | State | What is true at the end |
| --- | --- | --- | --- |
| 1 | Corpus and world seam | Done | A recorded game can be replayed, a generated game can be played, and a seat cannot tell which it is reading. |
| 2 | Session client | Done | The harness holds one persistent OpenCode session per seat, sends it an observation, and captures reasoning, calls, usage and cost. |
| 3 | Seat runtime and trace store | Done | A seat plays a turn end to end with its four tools, and every step lands in the trace store. |
| 4 | Simulated benchmark | Done | Several seats play a generated game together with a live diplomacy layer, and the run produces metrics and artifacts. |
| 5 | Analysis, roundup and tuning | In progress | Reasoning reads back per seat and turn, roundups reconstruct intentions, and variants are compared on the richness, stability and cost frontier. |
| 6 | Live path | Written, awaiting a game | The same seat runtime drives a real game through Vox MCP and the bridge, with the pacing policy and backend supervision. |
| 7 | Human seat and interface | Not started | A person plays one seat in the same game, and a usable interface shows the seats, the politics and the traces. |

## Stage 1: Corpus and world seam

A recorded four seat game was harvested into one JSONL fixture per seat, one record per turn, holding the exact observation the seat was sent and the calls that followed it. The harvester reads the recording straight from the git object store, so the working tree is left alone and the output is reproducible.

The world seam is deliberately small: give me the seats, tell me whether a seat has a turn, give me the observation, answer an inspect, and carry out a decision. A recorded game and a generated game both satisfy it, which is what let the state source change without the seat runtime changing.

## Stage 2: Session client

The client talks to the OpenCode server rather than the run command, for the reasons in the specification. It creates one session per seat and keeps it, sends an observation as a message, and reads the turn back from every message the turn produced. Reasoning, visible text and tool calls are separated and each is preserved, and the usage attached to each message is summed across the turn.

Each seat runs in its own working directory under its own configuration, denied every tool except the four civ tools, so an autonomous seat cannot reach the shell or the repository.

## Stage 3: Seat runtime and trace store

A seat's turn is one function: prepare the world, publish the snapshot a tool server in another process will read, render the observation, send it, serve or observe the tool calls that come back, apply the decision to the world, and record everything.

The four tools are inspect, communicate, commit_turn and pass. Reading goes to the world. Talking and trading go to the diplomacy log and have consequences inside the run. Committing and passing end the turn. A seat that never decides is recorded as unfinished rather than retried, because a seat that failed to decide is a fact about the run.

A gap is recorded when a seat asks for information the world does not hold. What seats keep asking for and not getting is the sharpest signal about what the observation should carry.

## Stage 4: Simulated benchmark

A run holds several seats in one session set, all playing one generated world with a shared diplomacy layer, so messages arrive, groups form and deals are proposed and answered. Seats cannot see each other's private reasoning, only what they say and do.

The world is calibrated against the recorded game rather than guessed, and circumstances can be injected on chosen turns so a run can study a reaction rather than only an undisturbed game.

## Stage 5: Analysis, roundup and tuning

The report measures how much the seats talked, who stayed silent, how long the quiet stretches ran, whether direct messages were answered in kind, and what it all cost, including the cache hit ratio and the cost per social operation. The comparison puts several runs side by side and lists what changed against the baseline. The watcher tails a run while it plays.

The tuning loop is the reason a simulation exists: define a variant, which is a change to what is presented, how it is worded or how a prompt is framed, run it against the same seed, and compare it on the richness, stability and cost frontier.

Two variants have been run and compared so far, and a third is in flight. The results are in FINDINGS.md. What remains is breadth: more variants, longer runs, and a settled answer to which lever moves diplomacy rather than which lever moves message counts.

## Stage 6: Live path

The seat runtime does not change. What changes is the world implementation, which reads live state through Vox MCP and writes the seats' decisions back as the game's own actions.

The live world is written. A turn's reads are fetched up front and the observation is rendered from what was fetched, which keeps the synchronous part of the world seam intact and means a seat asking about its cities does not make the server read them twice. A read that fails says so rather than losing the turn, and a committed action goes to the tool that owns it, so legality stays with the game. An action with no live equivalent is reported rather than dropped.

A run checks the tools it depends on before its first turn, because a missing tool discovered on turn forty wastes a game rather than a minute. The path is verified offline against a fake connection, which is what let it be written without launching Civilization V.

Three things are deliberately not built, because none of them can be tested without a real game. The pacing policy, meaning where a seat thinks relative to the game clock and how a commit is revalidated against a state that moved, is unsettled. The game's own deal system is not wired, so an agreement still lives in the harness's log rather than in the game's deal actions. And backend supervision, health checks and outage handling remain to be proven against a live stack, where a game keeps running whether the backend is healthy or not.

Backend supervision, health checks and outage handling move from desirable to required, because a live game keeps running whether the backend is healthy or not.

## Stage 7: Human seat and interface

One seat in the same game belongs to a person, who sees the same information a model seat sees and acts through the same tools. The interface shows the table, the politics as they happen, and the reasoning behind a decision, which is the same trace store read through a different lens.
