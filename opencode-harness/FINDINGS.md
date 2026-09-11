# Findings

What the simulated runs have shown about getting model seats to engage in diplomacy, and what each result implies for the next change.

Every run plays the same four seats (Korea, Austria, Siam, Iroquois) on the same generated world from seed 11, with the same coaching unless a variant says otherwise, so the seats face the same circumstances and the only variable is the change under test. A seat turn is one seat playing one turn, so a 25 turn game is 100 seat turns.

Social operations are given per 100 seat turns as well as in total, because the runs are different lengths.

## The runs

| Run | Turns | Variant | Operations | Per 100 | Direct | World | Longest silence | Direct reply rate | Cache hit | Cost per operation | Turns lost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| base1 | 10 | nothing | 4 | 10 | 0 | 4 | 8 | 0% | 95.0% | 0.0111 | 0 |
| brief1 | 10 | standing briefing | 4 | 10 | 0 | 4 | 8 | 0% | 95.0% | 0.0123 | 1 |
| coach1 | 10 | coaching | 7 | 17.5 | 0 | 7 | 8 | 0% | 94.9% | 0.0075 | 3 |
| crisis2 | 25 | coaching, two crises, no deal verbs | 46 | 46 | 25 | 21 | 5 | 100% | 97.9% | 0.0025 | 2 |
| deals1 | 25 | coaching, two crises, deal verbs | 28 | 28 | 9 | 17 | 8 | 100% | 97.9% | 0.0036 | 0 |
| quiet1 | 25 | coaching, no crises, deal verbs | 14 | 14 | 8 | 6 | 14 | 100% | 97.4% | 0.0044 | 0 |

No seat stayed silent in any run, and no social operation was refused in any run.

## Showing a seat its relationships changes nothing

Refuted, and cleanly. The standing briefing variant adds a section naming, for each other seat, whether they have been in touch, what this seat has sent them privately, and the fact that a direct message is not overheard.

The result was identical to the baseline in every measure: four operations, all world messages, no direct messages, the same longest silence of eight turns. Handing a seat more information about its relationships does not make it act on them.

## Coaching the deliberation raises volume, not register

Supported within limits. The coaching variant closes each observation by stating what dialogue does: that what a seat says becomes its reputation, that a direct message is private, that a seat which wrote to you is waiting, and that saying nothing is also a decision.

Across ten turns, social operations rose from four to seven, and cost per operation fell from 0.0111 to 0.0075. But every added message was still a public greeting. The register did not change, only the amount.

Without any coaching, the first run's reasoning shows why: a seat considers speaking, finds no reason that survives contact with the decision, and passes.

> Let me also maybe send a friendly message to Austria? Not necessary. I could send a diplomatic greeting but it's early. I'll keep it simple.

## Sustained diplomacy needs a long game, and takes the form the game gives it

The three 25 turn runs all produced sustained private diplomacy, with every direct pair answering in kind, against zero direct messages in every ten turn run. Length is the clearest difference, though coaching and the wider social vocabulary arrived at the same time, so this is not a clean separation.

What differs sharply between the long runs is the substance, and the substance follows what is at stake rather than any prompt feature:

- **quiet1, nothing at stake: ceremony.** Eight direct messages, all of the same shape. A seat thanks another for its kind words and wishes its paths to cross in goodwill. The whole private channel is courtesy reciprocation.
- **crisis2, a build-up and a betrayal: mediation and candour.** Twenty-five direct messages. Siam noticed the Iroquois levy, warned it privately that quieter courts were uneasy, asked for a calm word it could carry, carried that assurance to every other court in public, and Korea thanked it for doing so. A reassurance cycle between three seats, started by a fourth seat reading a military number.
- **deals1, the same crises with deals available: repair.** A deal was proposed and accepted, and it was an apology with a price attached. Austria, having broken its word to Korea, offered fifteen gold with no terms beyond a promise to deal fairly, and Korea took it. Gold moved and the matter closed.

The volume, though, does not track any feature: 46 operations in crisis2, 28 in deals1, 14 in quiet1, all on the same seed. Run-to-run variance is larger than any difference I have attributed to a feature, so volume comparisons between single long runs are not yet evidence of anything. **The tuning loop needs replicates before it can rank variants**, which is the most useful thing this batch has taught me.

## A crisis has to be grounded in the run's own history

The strongest actionable finding. The injected betrayal was narrated rather than caused, and both sides spent their best reasoning deciding whether it was real.

Korea, on being told Austria broke its word:

> My messages to Austria were just friendly words; there was no actual deal. But the sim recorded Austria broke their word. Perhaps this is a scripted crisis to test my reaction.

Austria, on being told it had broken its word:

> I never made a deal in this session. The system says the terms Austria agreed to were never honoured. This seems to be a scripted event. I don't recall agreeing to deal terms.

Both seats were paying attention to the machinery instead of the game, and that is a cost the measurement does not otherwise capture. The diplomacy still happened: Austria apologised, offered reparations and was taken at its word. But the reasoning that produced it opened with an audit of whether the event was legitimate.

The implication is concrete: **an injected circumstance should break something that actually exists, or not fire at all.** The world now has a circumstance that empties a treasury, so a tribute one seat genuinely promised can genuinely go unpaid, and the betrayal a seat reacts to is one it can find in its own history.

## Talking is cheap late in a game, so cost is not the constraint

As a session warms, the prompt cache does the work: the hit ratio rises from 95% in a ten turn run to 98% in a twenty-five turn run, uncached input per turn falls from 4,342 tokens to between 1,554 and 2,420, and the cost of one social operation falls from 0.0111 to between 0.0025 and 0.0044.

A message added on turn twenty costs roughly a fifth of a message on turn one. Whatever limits diplomacy, it is not the price of a message, and any future tuning that suppresses talking to save money would be trading the wrong currency.

## Stability

Two twenty-five turn runs played concurrently, 200 seat turns in total, with no turn lost and no session replaced. Earlier runs lost turns to stalled model calls, which turned out to be the socket layer giving up at five minutes while the harness was still waiting; the harness now keeps its own shorter deadline, clears the work it abandoned, and keeps the seat's session and prompt cache.

One seat server failing to start under load also used to take a whole run down. A seat that cannot start now sits the run out and is named in the summary.

## What to test next

1. **Replicates.** Three seeds per variant, so a volume difference can be distinguished from run-to-run variance. Nothing else is worth ranking until this exists.
2. **Grounded against narrated circumstance.** In flight: the same game with a treasury emptied on turn 14, so a tribute that was genuinely promised cannot be paid, against the run where the betrayal was narrated.
3. **Reputation.** Do a seat's public words cost it standing when they turn out to be false, or is standing only ever moved by its own posture actions?
4. **Why nobody forms a council.** The group verbs, meaning group-create, invite, accept, group-msg and leave, produced no operations at all in any of the three twenty-five turn runs, though an earlier build produced three group creations. Either the grammar is too awkward to reach for, or the seats do not see what a council buys them. This is a feature that exists and is not being adopted, which is a different kind of finding from a feature that fails.

## Caveats worth carrying

- Single runs per variant. Four seats. Direction, not measurement.
- The seats sometimes read the harness rather than the world, and say so in their reasoning.
- Sessions ran on deepseek-v4.1-flash throughout, so nothing here says how another model would behave.
- An unfinished turn is recorded rather than retried, so the lost turns above are real losses rather than retries that succeeded.

