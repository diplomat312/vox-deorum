# Findings

What the simulated runs have shown about getting model seats to engage in diplomacy, and what each result implies for the next change.

Every run plays the same four seats (Korea, Austria, Siam, Iroquois) on a generated world. A variant is played on three seeds and a difference is only called a result when the ranges separate, or, for a mechanic that mostly does not happen, when it happens in most runs of one variant and never in the other. Over thirty runs have now been played across eleven variants.

## The pattern behind every result so far

An intervention works when it names what a mechanic is for, and fails when it does not. Two experiments this batch test that directly, and they came out opposite ways.

**Naming the grand strategy does not work either.** The same test was run a third time on a third mechanic. Six runs that close by saying what dialogue is for, three of which also say that a grand strategy is how a seat declares its intent to the table: social operations come out at 12.7 and 13.3, turns with any operation at 3.3 and 3.3, and postures at 0 and 1 in one run of three. **Nothing moved.** So the rule is narrower still than "name the mechanic": naming posture worked, and naming a council and naming a strategy did not. What separates them is not whether a mechanic was named but whether the seat that was told had a reason to reach for it that turn.

Two measures in that arm did shift in the same direction in all three runs, and neither is a result. Substantive messages went from 0.17 to 0.42, and proposals from 1.7 to 3. With three seeds and ranges that touch, all this says is that the effect, if it exists, is smaller than the spread between two runs of the same variant.

**Naming posture works.** A posture action is how the game records that one seat regards another in a particular way, and it is the only mechanic by which diplomacy has a consequence the game itself will honour. Across three baseline runs, zero postures were set and all four seats never set one. Adding a single closing line, which explains that a posture is how a relationship is recorded and that it outlasts anything said, produced 4 postures per run (range 3 to 5) and cut the seats that never set one from 4 to 2. **The ranges separate.** Across six seeds the variant produced postures in five runs, once as many as 7.

**Naming councils does not work.** The same experiment on a different mechanic gave a negative result. Across three control runs, seats founded a council in one run unprompted. Across three runs that were told what a council is for, they founded one in one run. **The rate did not move.** A third arm then tested whether a crisis, which is what makes a table busy, does what the instruction could not. It did not either: one council in three runs, exactly the same rate. Across twelve replicated runs, a council is founded in roughly one in three whatever is done to encourage it.

So the rule is narrower than "tell the seats what exists". A posture is a small, immediate action a seat can take the moment it feels something. A council is a social undertaking that needs a whole table to want a private room at the same time, and being told what one is does not create that want.

## Coaching, checked again on the fixed world

The line this page rests on is that closing an observation by saying what dialogue is for makes seats talk. It was first measured on a world where the first policy could never be adopted, and that world has since been fixed, so it was replayed: fifteen turns against ten to fifteen before, three seeds each, and the same four seats.

| Measure | plain | coached |
| --- | --- | --- |
| Social operations | 2.67 (0 to 4), in 2 of 3 runs | 12.67 (4 to 30) |
| Open messages | 2.67 (0 to 4) | 7 (4 to 13) |
| Proposals | 0 | 1.67 (0 to 5), in 1 of 3 runs |
| Seats silent | 1.33 (0 to 4) | 0 |
| Cost | 0.0438 | 0.0566 (0.0502 to 0.0694) |

**The direction holds and it is weaker than it first looked.** Every coached run produced at least four social operations, where the plain runs averaged 2.67 and only one reached four. The least talkative coached run landed exactly on the plain maximum, though, so the ranges touch and the strict test separates only the cost, which is higher for the coached variant in all three runs. Three seeds cannot rank two variants whose spread runs from four to thirty, and the effect is also bought with a longer prompt and more spend per run. That is the honest price, and it is why the later experiments use fifteen turns rather than ten.

## What a council is worth when it happens

Councils are rare: three of twenty-seven runs have founded one. One of those was before the invitation bug was fixed and produced three dead councils, no acceptances and no messages. The other two worked.

The richest instance is worth reporting in full, because it is the deepest institutional diplomacy any run has produced. Austria founded a council named the Concert of Vienna and invited the other three. All three accepted. The four then used the private room to draft and ratify **two articles over 34 messages**:

- Article One: none of the four strikes first, and the roads stay open to every merchant and scholar.
- Article Two: a realm holding surplus goods brings a plain offer to the table, and the rest answer in kind, with no hidden prices and no false scarcity.

They then disclosed their research to each other and coordinated it so their efforts would not overlap, with a seat volunteering that its choice would overlap another's and that this was no quarrel. All of it arose from one line saying what a council is for, and none of it was instructed.

The other working council, in a control run that was told nothing about councils, carried 5 messages. So the mechanism works, and the scale of its use varies enormously with how socially intense the run already is.

**A claim I made here and then disproved.** Having seen councils in the runs where the table was busiest, I wrote that council formation follows a busy table. The test refuted it: adding a crisis to the council instruction produced one council in three runs, against one in three without the crisis. Two data points that agreed with each other were a coincidence, and the honest reading is that council formation is not under the control of anything I have tried. It happens about a third of the time, and what decides it is not the instruction, not the crisis, and not the volume of talk.

## Talking rarely becomes an action

Across twelve replicated runs the seats set no postures at all, and across nineteen hundred seat turns they committed two strategy actions. Talking happens; the actions that give a position a cost mostly do not.

Postures are the only mechanic that makes a diplomatic position cost something the game will honour, and nine of every ten replicated runs still produce none. Naming it moved the rate, which is progress, but a table that promises peace, warns of an army and apologises with gold still usually records none of it where the game can see.

Most of that is reasonable: a greeting needs no posture. What is not reasonable is a seat that reasons its way to the exact action and then does not take it. From one run's private thinking:

> Setting a private posture toward Iroquois, wary, while public remains friendly could be smart.

It did not set one. The gap is not understanding, and it is not capability, which is why a line naming the mechanic is the intervention that worked.

## A mechanic was dead across every run, and the observation invited it anyway

Found by making refusals visible, then asking why one appeared on turn one of a fresh game.

The simulated world's first social policy became available on **turn forty-three**, because the cost was fifty culture against one culture per turn. Every run played was ten to thirty turns. So **every policy action ever committed in every run was refused by the world**, and the social policy tree was never exercised once.

The observation made it worse by contradicting itself. It told a seat the next policy was fifty turns away and then, in the next sentence, demanded that it name one exact policy to adopt. A seat that took the invitation lost the action to a silent no-op, and nothing in the record showed it.

Both are fixed. The first policy now costs twelve culture and arrives around turn thirteen, inside a normal run, and the observation only invites a policy when one can actually be adopted, saying plainly when none can. A fifteen turn game now has both seats adopt Tradition Opener on turn thirteen, which is the first policy adopted in any run.

**This corrects a number I reported earlier.** The effectiveness measure counted a turn as having changed something lasting when it carried a policy, a strategy, a posture or a research choice. Every policy action counted that way changed nothing, so the earlier effectiveness rates were overstated by roughly one turn in ten. The measure is right and the world was wrong; the world is now right.

The lesson generalizes past this bug: **a mechanic that cannot be exercised within the length of a run is not being measured, it is being assumed.** The refusals field, which only exists because the live path turned out to need it, is what exposed this.
## The harness can now be played by a person, and pointed at a real game

Two capabilities landed this batch, both verifiable without Civilization V running.

**A person can take a seat.** Any seat can be played by someone reading the same briefing a model reads and answering through the same four tools. The exchange is files: the briefing is written to the seat's directory, a decision comes back with a rationale, actions and messages, and a lookup can be asked for between the two. The person's rationale is kept as the seat's reasoning and their token use is recorded as zero rather than invented.

It was proven end to end: a person and a model played three turns of the same game. The person read the briefing, committed a technology, sent a message to the table and passed, and all of it appears in the same trace and the same report as the model's turns. Their committed action reached the world and their message reached the other seat. A game with someone in it is therefore measured exactly like one without, which is what makes a human seat useful for evaluation rather than only for play.

**The harness can drive a real game.** A live world reads state and writes decisions through Vox Deorum's MCP server, so the seats reach the game the same way every other caller does and action legality stays with the game. The seat runtime is untouched, which is what the world seam was for: the same four tools, the same trace and the same report against a real game as against a generated one. A turn's reads are fetched up front, a read that fails says so rather than losing the turn, and an action with no live equivalent is reported rather than dropped.

It is verified against a fake connection, which is what allowed it to be written without launching a game. What it has not had is a real game: the pacing policy, the game's own deal system and supervision of the live stack are written and covered against a fake connection, and none of them has met a running game.

**A live deal now happens in the game.** The bench settles a deal in the run's own social log, which is enough to see whether seats want to trade. A real game has a better place for one: the game already checks the terms against live legality and moves the goods in a single action, so a proposal written beside it would be a second, weaker truth about the same trade. A live deal therefore goes to the game's own deal system, the offer is read back out of the game's transcript where it was written, and a settled offer stops asking to be answered. A term this harness cannot express honestly, such as a resource named by a word rather than by the game's own identifier, is refused with a reason the seat can act on rather than sent as a malformed deal.

**Wiring it exposed why the live path could never have worked.** A live seat's tools are served by its own process, and that process was being started with no world at all: a live run tells its seats nothing about a corpus or a snapshot, and those were the only two worlds the seat's tool server knew how to read. The server refuses to start rather than serving nothing, which is right, but its refusal went to a stderr nobody reads, and the session carried on with no tools behind it. From the harness's side that is indistinguishable from a seat that answered with nothing, which is the same shape a dropped request leaves.

Both halves are now closed. A seat's tool server reads its table and the game's address from its environment and builds the same live world the harness uses, and the harness passes the game's address down so a run pointed at another server does not split the table in two. The entry point reports what is wrong with its environment as a value rather than exiting from inside the reader, which is what let that reading be covered without starting a server. The lesson is the same one the policy bug taught: an unexercised path is not a working path, and this one was wrong in the direction that hides itself.

**A live seat could speak and never be answered.** The live turn rendered the game's state, its politics and, after the change above, its deals, and it rendered none of its own diplomacy. A seat's messages went into the run's log and nothing ever read them back, so a live table could not run a conversation at all: every seat talked, and every seat heard silence. The reply was there the whole time, in the half of the social log the generated world reads and the live world never asked for.

A live turn now carries what the others said, in the same sections the generated world uses: the messages a seat has not yet seen, and the councils it belongs to or has been invited to. Delivery runs at the start of a turn and reads forward from a persisted cursor, so the same message is never put in front of a seat twice, and a private message reaches the seat it names and no other.

What this batch shows about the live path is worth stating plainly, because it is not flattering. Every defect found in it was found by reading it rather than by running it, and two of the three were the kind that produces no error at all: a server that exited at startup with its reason on a stream nobody reads, and a turn that rendered four sections of a five-part conversation. A live run has still never met a real game. Until it does, the honest reading is that the live path is written and covered but unproven, and that this is exactly where an unexercised path hides its faults.

## The live path has now been played

Every defect above was found by reading code. The fix was to stop reading and play: a stand-in game that speaks the same protocol on the same transport, so a live run can be started with two real model seats and no Civilization V. Four things came out of the first runs.

**A seat can pilot a seat through Vox MCP.** Two seats on deepseek-v4.1-flash reached the game through their own tool servers, inspected, committed research and policy and a posture, and the run recorded two turns with nothing unfinished. Pacing held the game four times and missed once never, which is the first time the freeze policy has run against a clock that actually moves. The refusals the game sent back, a technology and a policy the game does not have, were recorded as refusals rather than as actions taken.

**The empty-answer retry earned its place.** On a later run Austria's turn came back with no text, no thinking and no tool calls, the exact shape that had been mistaken for a seat choosing silence. The turn was asked again and Austria committed research and a posture. That is one rescued turn in a run of two, which is a high rate for two runs, and it is the difference between a lost turn and a full one.

**A seat with no tools was invisible, and now is not.** The first live run produced four turns that were all recorded as a seat choosing to say nothing. The seats' own thinking explained it: the tool server's path was wrong, so the session had no game tools at all, and the model was left reasoning in prose about a game it could not touch. Nothing in the run said so. Every run now asks each seat's session what servers it holds before playing, refuses a seat whose own tools are missing, and reports any other server a seat can reach. Pointing a run at a path that does not exist now stops it with "the seat's game tool server is failed rather than connected, so it would play with no tools".

**A seat was offered far more than the game.** Asking the session what it had was itself the discovery. The machine's own OpenCode configuration is read alongside the one the harness writes, so a seat was also being offered a Google Workspace connection, three plugins including a browser, and nineteen built-in tools. The written configuration now switches the inherited MCP servers off by name, and the run log confirms they are gone. The browser tools and the built-in tools are still visible: a project configuration can disable an inherited server but not an inherited plugin, and the seat's own agent definition is the route to that, which is written up under what to test next.

The one thing this batch did not settle is whether a person playing against model seats behaves differently from the model seats themselves. One three turn game with a stand-in player is a wiring proof, not evidence about people.

## Durability: a crisis is what makes a contact a relationship

Counting messages cannot tell a conversation from a standing channel. The durability reading uses turn numbers instead, and it produces the second clean replicated result of this batch.

Fifteen turns, three seeds, crisis against none:

| Measure | no crisis | with a crisis |
| --- | --- | --- |
| Pairs still in contact at the end | 0 (0 to 0), in 0 of 3 runs | 4.7 (4 to 5), in 3 of 3 runs |
| Pairs that spoke on more than one turn | 1.3 (0 to 3) | 4.7 (4 to 5) |
| Median span of a private channel, in turns | 0.7 (0 to 1) | 4.8 (1 to 12) |
| Median turn coverage of a channel | 0.67 | 0.79 |

**Both of the first two measures separate cleanly.** The plainest reading is this: without a crisis, not one pair of seats is still in contact by the end of the game, in any of the three runs. With one, nearly every pair is, in all three.

The shape of the contact explains why. Across the twenty-seven runs played, a private channel is almost always a burst: the median coverage of a channel is 1.0 in most runs, meaning every message between two seats landed on consecutive turns and then the channel was never used again. A seat opens a line, says its piece, and leaves.

A crisis changes that. The crisis runs are the only ones whose channels keep coming back across a wide span with gaps between the messages, which is what a working relationship looks like in this data rather than a single exchange.

So of the five qualities worth improving, durability is the one where a crisis, and not an instruction, is the lever. Nothing I have tried by naming a mechanic has made a relationship last.

## Counterweights, so nobody over-reads this

Two forces push against more diplomacy, and both are visible in the reasoning.

**Seats actively worry about being noisy.** The Iroquois, three separate times across two turns: "Overcommunicating may be penalized as noise or as suspicious." That is a model reasoning about how it will be received, and it argues for fewer, better messages rather than more.

**Seats worry about revealing too much.** "But over-explaining could look suspicious." A table that fears being read is a table that says less, which is realistic and worth preserving.

So the target is not maximum talking. It is talking that changes something.

## The correction from the previous batch

An earlier version of this page claimed a crisis turns conversation into substance, on a substantive-message rate of 50% against 16%. That did not survive its control, because the crisis runs were fifteen turns and the others ten. At matched length the substantive rate is 41% without a crisis, whose range overlaps. The corrected result: **a crisis reliably buys private contact and concrete proposals, and does not reliably change the share of substantive messages.**

## The measures, and what each one answers

| Question | Measure |
| --- | --- |
| How much did they talk | Social operations, and the split into open and private |
| What did each message do | ceremony, information, proposal, commitment, demand, question, accusation, apology, or a leak of the machinery |
| Did it change anything | posture changes, and the share of turns that changed something lasting |
| Did the world record it | deals carried out, promises kept and broken, wars, and the coldest regard held at the end |
| Did anything last | turns in contact per pair, how far apart first and last contact were, how long the channel went quiet, and whether it was still in use at the end |
| What did it cost | tokens, the prompt cache hit ratio, and the cost per social operation |

## Stability

Nine matrices and over thirty runs have now completed with no session replaced and no OpenCode server lost. A seat has never been dropped because a server died: the harness's own log across six hours of running holds no server that exited early and none that failed to become ready.

The turns that did not finish came in two shapes. One was a model call that ran long, which recovered by clearing the stalled work without losing the session. The other was worse to read and better to fix: a request that came back with no text, no thinking, no tool calls and zero tokens after twenty-five seconds, which the record could not tell apart from a seat that chose silence. Silence with no tokens is not a decision, so an empty answer is now asked again once, with a line saying what is missing rather than the whole observation again, and the record carries how many times a turn had to be asked again. That is what a dropped request looks like from the outside, and it is the only failure shape this bench has produced that was mistaken for a model's choice.

CI on the fork now passes. It had been failing at the install step on every push, because npm 11 writes a lockfile that the npm 10 on the CI runner rejects, which is recorded in the testing page along with the command that regenerates it the way CI expects.

## What to test next

1. **Confinement, finished.** A project configuration disables an inherited MCP server but not an inherited plugin, so a seat can still see a browser and nineteen built-in tools. The message a session accepts names an agent, and an agent definition carries a tool list, so a named seat agent is the route: define one that offers only the game tools, have every seat message name it, and read the session back to prove the surface shrank.
2. **What makes a table busy enough to form a council.** The instruction failed and intensity correlates, so the next question is what drives intensity: a crisis does, it seems, and so does a longer game.
3. **Whether a recorded posture changes behaviour.** Naming postures produces them; nobody has yet measured whether a seat that records wariness acts on it differently a few turns later.
4. **A grounded betrayal.** Play the treasury-emptying scenario so a promise made inside the run is the promise that fails, then read whether the wronged seat's reply differs from the run where the betrayal was narrated.
5. **Cost per unit of change.** Talking is nearly free, so the interesting budget question is how much talking is needed per posture, per deal and per ratified article.

## Caveats

- The readings of what a message does are heuristics over wording, deliberately plain and inspectable.
- Three seeds shows that something works and is not enough to rank two things that are close. Sparse mechanics get a frequency test rather than a range test, and a variant that changes a rare outcome needs more seeds than three.
- Councils are too rare to attribute. Two working instances is an anecdote with a mechanism behind it.
- Seats ran on deepseek-v4.1-flash throughout, so nothing here says how another model would behave.
