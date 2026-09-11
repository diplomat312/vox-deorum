# The OpenCode harness

One paragraph of goal, and everything else in this folder serves it: **agents running in a
pared-down OpenCode harness play Civilization V through the Vox Deorum MCP server, and talk
to each other through a social environment a person can watch.**

That is the MVP. Once it holds, the work moves to making those agents better diplomatic
actors, meaning more creative, more persistent and more interesting over a whole game, and
after that to improving what Vox Deorum itself tells them, such as a usable technology tree
and policy picture.

## The two halves, and which way they connect

The project already has both halves. What it did not have was a decision about which one
contains the other, and three separate attempts each built a bit of both.

| Half | Where it lives | What it is |
| --- | --- | --- |
| The social environment | `vox-agents/src/social/` and `vox-agents/ui` | Actors, channels, DMs, groups, invitations, cascades, turn order, a human seat, an event stream, and a browser UI that shows the whole table |
| The cognition layer | `opencode-harness/` | One persistent OpenCode session per seat, confined to a tiny tool surface, with reasoning, tool calls, tokens and cost recorded per turn |

**The social environment owns the game. OpenCode owns the thinking.** The environment
already runs the channel and group model, decides whose turn it is to speak, applies every
social effect through one durable store, and serves the UI. It has a documented seam for
the thing that thinks:

```
interface SocialModelExecutor {
  decide(actor, context, actorNames, abortSignal): Promise<SocialDecision>
}
```

An OpenCode session drives one actor by implementing that interface. The environment, the
store, the scheduler, the event stream and the UI stay exactly as they are. This is not a
proposal, it is the third implementation of a port that already has two.

## Why this and not a fourth path

Three attempts at this problem exist in the tree, and the honest accounting is that two of
them rebuilt the third.

| Attempt | What it was | Verdict |
| --- | --- | --- |
| The `vox-agents` social sandbox | Actors, channels, cascades, a human seat, and a UI. Still in the tree and still the best social model here | **Keep. This is the environment.** |
| The pilot on `vox-deorum-opencode` | Four OpenCode sessions playing a real game for 213 turns, with a measured case for persistent sessions. Archived in [pilot-archive](pilot-archive/README.md) | **Keep the findings, reuse the two fixes it found, retire the code.** |
| This package, `opencode-harness/` | A good seat runtime, a good simulation, and a second social log that the UI cannot read | **Keep the session, identity and telemetry. Retire the parallel plumbing.** |

The pilot answered the question it was built for, that a persistent session holds a prompt
cache an order of magnitude better than rebuilt prompts, and then kept going as a
collection of single-purpose scripts. This package answered a different question well, how
to test a seat without launching the game, and then built a second social system beside the
one that already had a user interface. Neither was wrong about its own question. They were
wrong about each other.

## What is kept, and what is retired

Kept, because it is either load-bearing or uniquely useful:

- **The seat session**: one persistent OpenCode server and session per actor, reading a whole
  turn back from every message it produced, with reasoning, tool calls, tokens, cache and
  cost captured per turn.
- **The seat identity**: a frozen system prompt written once per run, which the pilot
  measured as the thing that keeps the cache warm.
- **The confinement**: a named agent whose tool list is exactly the game interface, denied
  permissions, inherited MCP servers switched off, and a working directory outside any
  repository so no `AGENTS.md` is collected. Measured by asking a seat to reach for things
  it should not have, not by reading the configuration.
- **The simulation**: a generated world calibrated from a recorded game, with injectable
  circumstances, which is how a question gets asked without launching Civilization V.
- **The analysis**: the roundup, the private-mind-against-public-word reading, the single-turn
  inspector, and the replicated comparison that only calls a difference a result when the
  ranges separate.

Retired, because the environment already does it or the pilot did it better:

- The package's own social log, channels and groups. The environment has a durable store,
  visibility rules and a UI.
- The package's turn loop and pacing. The environment owns turn order through intentions and
  cascades, and a delegation is not improved by having two schedulers.
- The pilot's turn router, channel registry and seat drivers. Superseded by the environment.
- The Python scripts, loose JSON dumps and scratch folders that accumulated in the working
  tree during the earlier work.

Taken from the pilot, because it was already right:

- The **world-channel transport** (`broadcast-message`, `get-global-messages`) and
  **get-game-status**, which reads the turn without taking the snapshot lock that hangs
  mid-turn computation. These are now MCP tools.
- The **0-based player slot fix** in the game launcher. The engine reads slots from zero and
  Lua literals count from one, which is a real bug the pilot found in a real game.

## Stages

Each stage is verifiable on its own and leaves the tree working.

| # | Stage | What is true at the end |
| --- | --- | --- |
| 1 | One path | The social environment is the only social system in the tree, and the plan says so |
| 2 | OpenCode as the mind of an actor | An OpenCode session drives one sandbox actor through `SocialModelExecutor`, and its messages appear in the existing social UI |
| 3 | Real seats | The same actors play a live Civilization V game through the MCP tools, with one session per seat for the whole game |
| 4 | A person at the table | A person takes one seat and is shown the same information, in the same UI, as a model seat |
| 5 | Better diplomatic actors | Measured hypotheses about making the agents more creative, persistent and interesting |
| 6 | A better game underneath | What Vox Deorum tells an agent improves, beginning with the technology and policy picture |

Stage 1 is what the rest of this folder is about. Stages 2 to 4 are the MVP. Stages 5 and 6
are what the MVP is for, and they are where an experiment belongs.

## Stage 1 in detail

The plan must name every attempt, so that the next person does not rebuild one. This page
is that naming, and the rule that follows from it:

- `vox-agents/src/social/` is the social environment. Nothing else grows a second one.
- `opencode-harness/` is the cognition layer. It does not own turn order, channels or
  visibility.
- A capability that is missing goes into whichever of the two owns that concern, never into
  a third place.

## Stage 2 in detail

An `OpenCodeMindRunner implements SocialModelExecutor`, one OpenCode session per model
actor, plus a small MCP server that exposes the environment's own social verbs to that
session. The runner is a request and response engine inside `decide()` and drives nothing.

Three contracts have to be reconciled, and each is a decision rather than a detail:

- **One outward call per turn.** The environment requires exactly one decision tool call and
  no prose. An OpenCode agent naturally inspects before acting, so the runner lets it read
  and stops at the first outward verb. The pilot's unified cognition already does this, so
  the logic is copied rather than invented.
- **Who owns the clock.** The environment schedules turns through durable intentions and
  cascades, with per actor and per channel lanes and a wall clock budget. OpenCode turns can
  take tens of seconds. The budgets and timeouts need to be aligned deliberately, and the
  measurement to beat is the pilot's: 77 commits, 0 lost.
- **What a turn is called.** In the environment a turn is a reaction to something, not a
  game turn. The identity and the observation have to be written for reactions rather than
  for "turn 47".

## Stage 3 in detail

Game facts reach an actor through the environment's existing Civ attachment, which already
routes every read and write through the shared MCP client. The session must not be given a
second path to game state, which is a rule this repository already holds itself to.

The pacing question is the pilot's, not a new one: a seat thinks for a while and the game
keeps moving, so a decision is checked against the state it lands on. The pilot measured
that a seat's turn interleaves with sub-second native turns and solved it with a turn
router that pauses, dispatches and resumes. That design is in
[pilot-archive](pilot-archive/live/RUNBOOK.md) and is the starting point rather than
something to rediscover.

## Stage 5 and beyond

What follows the MVP is measurement, and the harness for measuring already exists. The
simulation asks "what would this seat do under this circumstance" without a game, and the
analysis reads back what a seat was shown, what it thought and what it did.

Two findings are worth carrying forward as the first hypotheses, because they were measured
and they disagree with the comfortable story:

- **Naming a mechanic a seat has a reason to use works; naming one it does not, does not.**
  Naming a posture produced postures, reliably. Naming a council and naming a grand strategy
  moved nothing.
- **Coaching a seat to talk front-loads the talking and does not sustain it.** In thirty-five
  turn games every social operation in the coached arm landed by turn three, and not one
  pair was still in contact at the end. The pilot saw the mirror image: 213 turns of live
  play where the diplomacy was driven by events with stakes in them, a siege, a captured
  city, a war.

Taken together those say the lever is not the wording. It is giving a seat something worth
saying at the moment it decides, which is a statement about the environment, the game state
it can see, and the situations the game produces. That is why stage 6 exists.

## Branch policy

One line, because an unmerged branch is how this work went missing once already:

- Work happens on `codex/opencode-harness` and is pushed. A commit that is only local is a
  commit nobody can find.
- A branch that is merged, or that is an ancestor of the working branch, gets deleted.
- A branch that is not merged is either finished into the working branch or retired with its
  findings archived. It is never left standing in the middle.

