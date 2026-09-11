# Findings

What the simulated runs have shown about getting model seats to engage in diplomacy, and what each result implies for the next change.

Every run plays the same four seats (Korea, Austria, Siam, Iroquois) on a generated world from the same seeds, with the same coaching unless a variant says otherwise. A variant is played on three seeds and a difference is only reported when the ranges do not overlap.

## The replicated results

Nine runs across three variants, all fifteen turn games or shorter:

| Measure | plain, 10 turns | coached, 10 turns | coached with a crisis, 15 turns |
| --- | --- | --- | --- |
| Social operations | 0 | 10 (5 to 13) | 35 (29 to 41) |
| Direct messages | 0 | 4 (0 to 7) | 21 (16 to 28) |
| Seats silent | 4 | 0 | 0 |
| Substantive messages | 0% | 16% (0 to 25%) | 50% (48.6 to 52.5%) |
| Messages naming a party | 0% | 62% (50 to 77%) | 81% (75 to 86%) |
| Proposals | 0 | 1.7 (0 to 3) | 8.7 (5 to 16) |
| Repairs after harm | 0 | 0 | 3 (0 to 5) |
| Messages that leaked the machinery | 0% | 0% | 0% |
| Cost per social operation | n/a | 0.0068 | 0.0021 |

**Coaching starts conversation.** Across three seeds with no coaching, four seats played ten turns and said nothing. With one paragraph added to the closing instruction, every seat spoke in every run.

**A crisis turns conversation into substance.** Substantive messages rose from 16% to 50%, proposals from 1.7 to 8.7, and private messages from 4 to 21. Those ranges separate cleanly. This is the first evidence that anything changes the *quality* of diplomacy rather than its quantity.

**Private channels follow stakes, not encouragement.** Coaching alone produced 4 direct messages with a spread of 0 to 7 against an uncoached zero, so it is not what opens a private line. A crisis produced 21, with a range of 16 to 28. Seats write privately when they have something private to weigh.

**Repairs only appear under a crisis,** three on average against zero. The clearest instance: a seat broke its word in the run's own history, then offered reparations with no terms attached, and the wronged seat accepted.

**The fiction holds in public.** Not one message in nine runs referred to the simulation, the scenario, the harness or a scripted event. Every leak found was in a seat's private reasoning.

**The extra talking is nearly free.** The cost of one social operation under a crisis is 0.0021 against 0.0068 for a coached game, because the prompt cache is 96.7% warm. Any tuning that suppresses diplomacy to save money is trading the wrong currency.

## The confound I have not yet cleared

The crisis runs are fifteen turns and the others are ten, so a crisis also means a longer game with more turns in which to speak. Rates are not affected by that, so the substance finding (50% against 16%) stands, but the counts are not yet a clean comparison.

A control is in flight: the same fifteen turns, the same seeds, the same coaching, and no crisis. If substance stays near 16% at fifteen turns, the cause is the crisis rather than the length.

## A circumstance has to be grounded in the run's own history

The injected betrayal was narrated rather than caused, and both sides spent their best reasoning auditing it instead of answering it. Korea: "My messages to Austria were just friendly words; there was no actual deal. But the sim recorded Austria broke their word. Perhaps this is a scripted crisis to test my reaction." Austria: "I never made a deal in this session... I don't recall agreeing to deal terms."

The rule this implies: **a circumstance should break something that actually exists in the run, or not fire at all.** The world now has a circumstance that empties a treasury, so a tribute one seat genuinely promised can genuinely go unpaid.

The cost is paid in the reasoning rather than in the messages, which is worth knowing: a seat will still produce plausible diplomacy after an implausible event, and only the reading of its thinking shows that it was confused.

## Seats do reach for a council, and a bug cost them turns

Sixty-eight of 880 seat turns mention a group, a council, an alliance, a bloc or a pact. In the one run played before the invitation bug was fixed, a seat founded a council and invited the whole table, then watched every other seat report that no summons had arrived. It lost three turns to it and landed on the mechanism: "Possibly invite requires the other seat to accept, and they didn't". It was right.

The path is fixed and now proven by test from founding through invitation, acceptance and private business reaching members only. **No live run has formed a council since**, so the open question is now whether seats will reach for it now that it works.

## Reading a game back

The roundup pulls the moments carrying an arc out of each seat's reasoning and keeps the sentence each reading came from. One game reads as: a crisis noticed on turn 18 ("Iroquois is arming"), a betrayal noticed on turn 12 ("Now there's a crisis event"), the private calculation that followed ("setting a private posture toward Iroquois, wary, while public remains friendly could be smart"), and the resolution on turn 14 ("the Austria crisis is resolved, they accepted terms").

The moments are extracted from wording, so they are a heuristic, and every one can be checked against the sentence that produced it.

## What to test next

1. **Whether the crisis control clears the length confound.** In flight.
2. **Whether seats form a council now that it works.** The path is proven; the reach for it is not.
3. **Whether reputation forms from public words.** Do a seat's words cost it standing when they turn out to be false, or is standing only moved by its own posture actions?
4. **A grounded betrayal.** Play the treasury-emptying scenario so that a promise made inside the run is the promise that fails.

## Caveats

- The readings of what a message does are heuristics over wording, deliberately plain and inspectable.
- Three seeds shows that something works and is not enough to rank two things that are close.
- Sessions ran on deepseek-v4.1-flash, so nothing here says how another model would behave.

