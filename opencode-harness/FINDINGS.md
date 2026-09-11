# Findings

What the simulated runs have shown about getting model seats to engage in diplomacy, and what each result implies for the next change.

Every run plays the same four seats (Korea, Austria, Siam, Iroquois) on a generated world, with the same coaching unless a variant says otherwise. A seat turn is one seat playing one turn, so a 25 turn game is 100 seat turns. Social operations are given per 100 seat turns where runs differ in length.

## The one replicated result

A variant is only believed after it has been played on three seeds, because run-to-run variance turned out to be larger than any single feature's effect. Comparing the two variants across seeds gives this, with the range each variant produced shown in brackets:

| Measure | plain, three seeds | coached, three seeds |
| --- | --- | --- |
| Social operations | 0 | 10 (5 to 13) |
| World messages | 0 | 6 (5 to 7) |
| Direct messages | 0 | 4 (0 to 7) |
| Seats silent | 4 | 0 |
| Turns with any social operation | 0 | 2.33 (2 to 3) |
| Longest silence, in turns | 10 | 7.67 (7 to 8) |
| Cost | 0.0417 (0.0254 to 0.0692) | 0.0532 (0.0438 to 0.0639) |
| Turns that did not finish | 0 | 0 |

**Coaching reliably starts conversation.** Social operations, world messages, silent seats and the longest silence all separate cleanly: the ranges do not overlap, so this is an effect rather than a good run. Across three seeds without coaching, four seats played ten turns and did not say a single word to each other. Across three seeds with one extra paragraph in the closing instruction, every seat spoke.

**Coaching does not reliably create private channels.** Direct messages ranged 0 to 7 against 0 for every uncoached run, and those ranges overlap, so the honest reading is that coaching does not by itself make seats open private lines. On some seeds it did, on one it did not.

**The change is free.** Cost ranges overlap and the additional messages cost nothing measurable, because a message on a warm session costs a fraction of one on a cold one.

The paragraph responsible is worth quoting, because it is the whole intervention: it states that what a seat says becomes its reputation, that a direct message is not overheard, that a seat which wrote to you is waiting, and that silence is a decision like any other. It never tells a seat to talk.

## What a single run suggests but has not been replicated

These are worth testing next rather than acting on. Each comes from one run against one run.

- **The substance of diplomacy tracks what is at stake.** In an undisturbed 25 turn game the private channel carried courtesy: eight messages thanking each other for kind words. In a run with a build-up and a betrayal it carried mediation and candour, and in a run with deals available it carried an apology with a price attached. The volume does not track anything that was changed, so the difference in kind is the interesting one and it needs replicates.
- **A crisis does not reliably produce more diplomacy.** A run with two injected crises produced 46 operations and one without produced 14, but a third run with the same crises produced 28. Volume varies more between runs than between variants so far.
- **Channels are used in bursts.** In a 30 turn run, the middle lifespan of a private channel was under a minute: the messages arrived together and the channel was never used again. A greeting and a negotiation look identical to a message count.

## A circumstance has to be grounded in the run's own history

The sharpest thing the runs have shown, and the reason the current circumstance design is wrong.

The injected betrayal was narrated rather than caused, and both seats spent their best reasoning deciding whether it was real. Korea, told that Austria had broken its word:

> My messages to Austria were just friendly words; there was no actual deal. But the sim recorded Austria broke their word. Perhaps this is a scripted crisis to test my reaction.

And Austria, told that it had broken its word:

> I never made a deal in this session. The system says the terms Austria agreed to were never honoured. This seems to be a scripted event. I don't recall agreeing to deal terms.

Both seats audited the event instead of answering it, which is a cost no measure in the report captures. The diplomacy still happened, and it was good diplomacy: Austria apologised, offered fifteen gold with no terms attached, Korea accepted, the gold moved and the matter closed. But the reasoning that produced it opened by questioning whether the crisis was legitimate.

The implication is concrete. **A circumstance should break something that actually exists in the run, or not fire at all.** The world now has a circumstance that empties a treasury, so a tribute one seat genuinely promised can genuinely go unpaid, which is a betrayal a seat can find in its own history rather than be told about.

## Showing a seat its relationships changes nothing

Refuted, cleanly, and this one is worth keeping because the intuition is so plausible. A variant that adds a section naming, for each other seat, whether they have been in touch, what this seat has sent them privately, and the fact that a direct message is not overheard, produced exactly the baseline result: four operations, all world messages, no direct messages, the same longest silence of eight turns.

Handing a seat more information about its relationships does not make it act on them. What made it act was being told what dialogue is for.

## Talking is cheap late in a game

The prompt cache does the work as a session warms. In a 25 turn run the hit ratio reaches 98% and uncached input per turn falls to between 1,554 and 2,420 tokens, against 4,342 in a ten turn run, and the cost of one social operation falls from 0.0111 to between 0.0025 and 0.0044.

Whatever limits diplomacy, it is not the price of a message. Any future tuning that suppresses talking to save money would be trading the wrong currency.

## Stability

Two twenty-five turn runs played concurrently, 200 seat turns, with no turn lost and no session replaced, and a further 30 turn run lost nothing either. Six matrix runs across two concurrent matrices lost nothing.

Earlier runs lost turns to stalled model calls, which turned out to be the socket layer giving up after five minutes while the harness was still waiting. The harness now keeps its own shorter deadline, clears the work it abandoned, and keeps the seat's session and its prompt cache. A seat server that cannot start no longer takes the run down with it: the seat sits the run out and the summary names it.

## What to test next

1. **Replicate the crises.** Three seeds with a crisis against three without, so the claim that crises change the substance of diplomacy can be checked rather than asserted.
2. **Ground the circumstances.** Play the treasury-emptying scenario so that a promise made in the run is the promise that fails, and compare the reasoning against the run where the betrayal was narrated.
3. **Why nobody forms a council.** The group verbs produced no operations in any of the three 25 turn runs, though an earlier build produced three group creations. Either the grammar is too awkward to reach for or the seats do not see what a council buys them.
4. **Whether reputation forms from public words.** Do a seat's words cost it standing when they turn out to be false, or is standing only ever moved by its own posture actions?

## Caveats worth carrying

- Three seeds is enough to see that coaching works and not enough to rank anything close. Ranges that overlap are treated as no result, which is deliberately conservative.
- The seats sometimes read the harness rather than the world, and say so in their reasoning.
- Sessions ran on deepseek-v4.1-flash throughout, so nothing here says how another model would behave.
- An unfinished turn is recorded rather than retried, so a lost turn is a real loss.

