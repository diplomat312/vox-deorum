# Findings

What the simulated runs have shown about getting model seats to engage in diplomacy, and what each result implies for the next change.

Every run plays the same four seats (Korea, Austria, Siam, Iroquois) on a generated world. A variant is played on three seeds and a difference is only called a result when the ranges separate, or, for a mechanic that mostly does not happen, when it happens in most runs of one variant and never in the other. Twenty-seven runs have now been played across seven variants.

## The pattern behind every result so far

An intervention works when it names what a mechanic is for, and fails when it does not. Two experiments this batch test that directly, and they came out opposite ways.

**Naming posture works.** A posture action is how the game records that one seat regards another in a particular way, and it is the only mechanic by which diplomacy has a consequence the game itself will honour. Across three baseline runs, zero postures were set and all four seats never set one. Adding a single closing line, which explains that a posture is how a relationship is recorded and that it outlasts anything said, produced 4 postures per run (range 3 to 5) and cut the seats that never set one from 4 to 2. **The ranges separate.** Across six seeds the variant produced postures in five runs, once as many as 7.

**Naming councils does not work.** The same experiment on a different mechanic gave a negative result. Across three control runs, seats founded a council in one run unprompted. Across three runs that were told what a council is for, they founded one in one run. **The rate did not move.**

So the rule is narrower than "tell the seats what exists". A posture is a small, immediate action a seat can take the moment it feels something. A council is a social undertaking that needs a whole table to want a private room at the same time, and being told what one is does not create that want.

## What a council is worth when it happens

Councils are rare: three of twenty-seven runs have founded one. One of those was before the invitation bug was fixed and produced three dead councils, no acceptances and no messages. The other two worked.

The richest instance is worth reporting in full, because it is the deepest institutional diplomacy any run has produced. Austria founded a council named the Concert of Vienna and invited the other three. All three accepted. The four then used the private room to draft and ratify **two articles over 34 messages**:

- Article One: none of the four strikes first, and the roads stay open to every merchant and scholar.
- Article Two: a realm holding surplus goods brings a plain offer to the table, and the rest answer in kind, with no hidden prices and no false scarcity.

They then disclosed their research to each other and coordinated it so their efforts would not overlap, with a seat volunteering that its choice would overlap another's and that this was no quarrel. All of it arose from one line saying what a council is for, and none of it was instructed.

The other working council, in a control run that was told nothing about councils, carried 5 messages. So the mechanism works, and the scale of its use varies enormously with how socially intense the run already is.

The correlation is worth stating plainly: the runs that formed councils are the runs where the table was talking most. Council formation follows a busy table rather than causing one.

## The finding that still matters most: talking rarely becomes an action

Postures are the only mechanic that makes a diplomatic position cost something the game will honour, and nine of every ten replicated runs still produce none. Naming it moved the rate, which is progress, but a table that promises peace, warns of an army and apologises with gold still usually records none of it where the game can see.

Most of that is reasonable: a greeting needs no posture. What is not reasonable is a seat that reasons its way to the exact action and then does not take it. From one run's private thinking:

> Setting a private posture toward Iroquois, wary, while public remains friendly could be smart.

It did not set one. The gap is not understanding, and it is not capability, which is why a line naming the mechanic is the intervention that worked.

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

Seven matrices and twenty-seven runs have now completed with no lost turn from a stall and no session replaced. Two runs had a seat lose a turn to a model call that ran long, and both recovered by clearing the stalled work without losing the session.

CI on the fork now passes. It had been failing at the install step on every push, because npm 11 writes a lockfile that the npm 10 on the CI runner rejects, which is recorded in the testing page along with the command that regenerates it the way CI expects.

## What to test next

1. **What makes a table busy enough to form a council.** The instruction failed and intensity correlates, so the next question is what drives intensity: a crisis does, it seems, and so does a longer game.
2. **Whether a recorded posture changes behaviour.** Naming postures now produces them; nobody has yet measured whether a seat that records wariness acts on it differently a few turns later.
3. **A grounded betrayal.** Play the treasury-emptying scenario so a promise made inside the run is the promise that fails, then read whether the wronged seat's reply differs from the run where the betrayal was narrated.
4. **Cost per unit of change.** Talking is nearly free, so the interesting budget question is how much talking is needed per posture, per deal and per ratified article.

## Caveats

- The readings of what a message does are heuristics over wording, deliberately plain and inspectable.
- Three seeds shows that something works and is not enough to rank two things that are close. Sparse mechanics get a frequency test rather than a range test, and a variant that changes a rare outcome needs more seeds than three.
- Councils are too rare to attribute. Two working instances is an anecdote with a mechanism behind it.
- Seats ran on deepseek-v4.1-flash throughout, so nothing here says how another model would behave.

