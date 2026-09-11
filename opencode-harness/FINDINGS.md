# Findings

What the simulated runs have shown about getting model seats to engage in diplomacy, and what each result implies for the next change.

Every run plays the same four seats (Korea, Austria, Siam, Iroquois) on a generated world from the same three seeds. A variant is played on all three seeds and a difference is only called a result when the ranges do not overlap. Fifteen runs have now been played across five variants.

## The correction I owe the record

An earlier version of this page claimed that a crisis turned conversation into substance, on the strength of a substantive-message rate of 50% under a crisis against 16% without one. **That claim did not survive its control.**

The crisis runs were fifteen turns and the others were ten, so the crisis runs also had more turns in which to speak. Playing the same fifteen turns on the same seeds with no crisis gives a substantive rate of 41%, whose range overlaps the crisis range. Most of the rise was the length of the game, not the crisis.

The corrected result is narrower and more useful: **at matched length, a crisis reliably buys private contact and concrete proposals, and does not reliably change the share of substantive messages.**

## What survives its control

Fifteen turns, three seeds, same world, crisis against no crisis:

| Measure | no crisis | with a crisis | Separated |
| --- | --- | --- | --- |
| Direct messages | 4 (0 to 9) | 21 (16 to 28) | yes |
| World messages | 5 (4 to 6) | 12 (11 to 14) | yes |
| Proposals | 2 (1 to 3) | 8.7 (5 to 16) | yes |
| Cost per social operation | 0.0070 | 0.0021 | yes |
| Substantive messages | 41% (28.6 to 60%) | 50% (48.6 to 52.5%) | no |
| Social operations | 13.7 (5 to 29) | 35 (29 to 41) | no |
| Repairs after harm | 0 | 3 (0 to 5) | no |
| Turns with any social operation | 4.7 (2 to 10) | 6.3 (6 to 7) | no |

So a crisis does three reliable things: seats write to each other privately, they speak to the whole table more, and they make specific proposals. It does not reliably make a larger share of what they say substantive, and it does not reliably produce an apology.

## What coaching does, against its own control

Ten turns, three seeds, coaching against none:

| Measure | no coaching | with coaching | Separated |
| --- | --- | --- | --- |
| Social operations | 0 | 10 (5 to 13) | yes |
| World messages | 0 | 6 (5 to 7) | yes |
| Seats silent | 4 | 0 | yes |
| Direct messages | 0 | 4 (0 to 7) | no |
| Substantive messages | 0% | 16% (0 to 25%) | (no baseline to overlap) |

**Coaching reliably starts conversation, and does not reliably open private channels.** Four seats played ten turns in silence three times over without it; with one paragraph added to the closing instruction, every seat spoke in every run. The paragraph never asks a seat to talk. It states that what a seat says becomes its reputation, that a direct message is not overheard, that a seat which wrote to you is waiting, and that silence is a decision like any other.

## The finding that matters most: talking almost never becomes an action

A posture action is how the game records that one seat regards another in a particular way, and it is the only mechanic in this harness by which diplomacy has a consequence the game itself will honour. It is almost never used.

Across twelve replicated runs, the count of posture changes is zero, and in every one of them **all four seats never set a posture toward anyone**. One run out of fifteen used the action at all, twice. Every promise of friendship, every pledge not to attack, every warning about a massing army, and every apology with gold attached was sent as text and recorded nowhere the game can see.

That is the gap the objective names when it says diplomacy should be effective. A table can talk beautifully, at trivial cost, and leave no trace in the world.

The mechanism exists and is reachable: the posture action is in the commit surface, the game applies it, and the observation shows the standing between seats. What is missing is any reason for a seat to reach for it, which is the same class of problem as the council that nobody could hear: a capability that exists and is not connected to anything a seat is trying to do.

**A variant naming posture in the closing instruction is in flight**, and it is the change most likely to move effectiveness rather than volume.

## Seats do reach for a council, and a bug cost them turns

Sixty-eight of 880 seat turns mention a group, a council, an alliance, a bloc or a pact. In the one run played before the invitation bug was fixed, a seat founded a council and invited the whole table, then watched every other seat report that no summons had arrived. It lost three turns and landed on the mechanism: "Possibly invite requires the other seat to accept, and they didn't". It was right.

The path is fixed and proven by test from founding through invitation, acceptance and private business reaching members only. No run has formed a council since, and the verb counts for group actions are zero across the twelve replicated runs, so a second variant that says what a council is for is also in flight.

## The fiction holds in public and leaks only in private thought

Across fifteen runs, **not one message referred to the simulation, the scenario, the harness or a scripted event**. Every leak found was in a seat's private reasoning. The injection that a seat audited hardest was the narrated betrayal: Korea called it a scripted crisis, and Austria said it had never agreed to any terms.

The rule that follows: **a circumstance should break something that actually exists in the run, or not fire at all.** The world now has a circumstance that empties a treasury, so a tribute one seat genuinely promised can genuinely go unpaid. The cost of an implausible event is paid in the quality of a seat's deliberation rather than in the believability of the table, which means only a reading of the reasoning shows it at all.

## Talking is cheap, and the cache is why

A twenty-five turn run reaches a prompt cache hit ratio of 98%, with uncached input per turn between 1,554 and 2,420 tokens against 4,342 in a ten turn run. The cost of one social operation is 0.0021 under a crisis against 0.0070 without one.

Whatever limits diplomacy, it is not the price of a message. Any tuning that suppresses talking to save money would be trading the wrong currency.

## Reading a game back

The roundup pulls the moments carrying an arc out of each seat's reasoning and keeps the sentence each reading came from. One game reads as: a crisis noticed on turn 18 ("Iroquois is arming"), a betrayal noticed on turn 12 ("Now there's a crisis event"), the private calculation that followed ("setting a private posture toward Iroquois, wary, while public remains friendly could be smart"), and the resolution on turn 14 ("the Austria crisis is resolved, they accepted terms").

Note the irony in that second sample: a seat reasoned its way to the exact action that would have recorded its wariness in the game, and then did not take it. The gap is not understanding.

## What to test next

1. **Whether naming posture produces postures**, and whether a recorded regard changes what the seats do afterwards. In flight.
2. **Whether naming what a council is for produces a council.** In flight.
3. **A grounded betrayal.** Play the treasury-emptying scenario so that a promise made inside the run is the promise that fails.
4. **Whether reputation forms from public words.** Do a seat's words cost it standing when they turn out to be false, or is standing only moved by its own posture actions?

## Caveats

- The readings of what a message does are heuristics over wording, deliberately plain and inspectable. Every label can be checked against the message it came from.
- Three seeds is enough to show that something works and not enough to rank two things that are close. Every claim above that depends on overlapping ranges is marked as not a result, including one I previously reported as a finding.
- Seats ran on deepseek-v4.1-flash throughout, so nothing here says how another model would behave.

