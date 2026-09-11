# Findings

What the simulated runs have shown about getting model seats to engage in diplomacy, and what each result implies for the next change.

Every run plays the same four seats (Korea, Austria, Siam, Iroquois) on a generated world, with the same coaching unless a variant says otherwise. A seat turn is one seat playing one turn. Roughly 880 seat turns have now been played, and about 200 messages sent.

## What a message does, not just how many

Counting messages measures quantity and says nothing about quality: a table exchanging courtesies and a table negotiating a border both produce traffic. Each message is now read for what it is for, from its wording, and the results are plain.

| Run | Messages | Substantive | Named a party | Proposals | Commitments | Apologies | Ceremony only |
| --- | --- | --- | --- | --- | --- | --- | --- |
| base1, nothing | 4 | 0% | 50% | 0 | 0 | 0 | 4 |
| brief1, standing briefing | 4 | 0% | 50% | 0 | 0 | 0 | 4 |
| coach1, coaching | 7 | 29% | 86% | 2 | 1 | 0 | 5 |
| quiet1, 25 turns, no crisis | 14 | 14% | 71% | 1 | 1 | 0 | 12 |
| deals1, crisis and deals | 27 | 41% | 85% | 5 | 5 | 2 | 16 |
| crisis2, crisis, no deal verbs | 46 | 54% | 67% | 12 | 12 | 0 | 21 |
| real1, 30 turns, grounded scenario | 15 | 27% | 87% | 2 | 2 | 0 | 11 |

Every message that named a party beyond its author did so by civilization or leader name. Not one used the harness's seat id, which is worth knowing when writing anything a seat reads.

## Coaching changes what seats say, not only how much

This is the strongest result so far, and the quality reading strengthens it beyond the volume finding.

Without coaching, over three seeds of ten turns, four seats sent nothing at all. With coaching, every seat spoke in every run, and the messages were not merely more numerous: **29% carried substance against 0%**, and proposals and commitments appeared where previously there had been none. Even in a 25 turn uncoached-adjacent game the substantive rate stayed at 14%, a fifth of a run with coaching and a crisis.

The paragraph responsible never tells a seat to talk. It states that what a seat says becomes its reputation, that a direct message is not overheard, that a seat which wrote to you is waiting, and that silence is a decision like any other.

What coaching does not do is reliably create private channels: across three seeds the direct message count ranged 0 to 7, overlapping the uncoached zero, so private lines are not something that paragraph controls.

## Substance rises with stakes, and the stakes have to be real

Ceremony dominates when nothing is at stake: quiet1 produced 12 ceremony-only messages out of 14. When a crisis was in play, half the messages carried information, proposals, commitments, warnings or an apology.

The sharpest instance is an apology. In deals1, 2 of 27 messages were repair after harm, and they arrived because one seat had genuinely wronged another in the run's own history: Austria broke its word, then offered fifteen gold with no terms attached, and Korea accepted it. The gold moved and the matter closed.

That happened despite the betrayal being narrated rather than caused, and the cost of narrating it is measurable in the reasoning. Both sides spent their best thinking auditing the event rather than answering it. Korea: "My messages to Austria were just friendly words; there was no actual deal. But the sim recorded Austria broke their word. Perhaps this is a scripted crisis to test my reaction." Austria: "I never made a deal in this session... I don't recall agreeing to deal terms."

The rule this implies: **a circumstance should break something that actually exists in the run, or not fire at all.** The world now has a circumstance that empties a treasury, so a tribute one seat genuinely promised can genuinely go unpaid.

## The fiction holds in public and leaks only in private thought

A reassuring correction. In 880 seat turns of messages, **not one message referred to the simulation, the scenario, the harness or a scripted event.** Every leak found was in a seat's private reasoning, never in what it said to anyone else.

So the immersion cost of an implausible circumstance is paid in the quality of a seat's deliberation, not in the believability of the table. That is a smaller problem than it first appeared, and it is invisible to every measure except a reading of the reasoning.

## Seats do reach for a council, and a bug cost them turns

The open question was why the group verbs had never been used. The answer is that they had, and the feature was broken.

Sixty-eight of 880 seat turns mention grouping, a council, an alliance, a bloc or a pact in their reasoning. In the run played before the invitation bug was fixed, one seat founded a council, invited the whole table, and then watched every other seat report that no summons had arrived. It spent three turns on it, and its reasoning landed on the mechanism: "Possibly invite requires the other seat to accept, and they didn't". It was right, and the invitation had never been visible to the invitees.

That bug is fixed, and the whole path is now proven by test: a council is founded, the founder sees who was asked, an invitee sees the council and the id it must name, an uninvited seat is not told the council exists, and once a seat accepts, the council business reaches members and not an invited seat that never accepted.

**No live run has formed a council since the fix**, so the question is now open in a different way: whether seats will form one now that it works, or whether they need to see what a council is for.

## Talking is cheap, and the cache is why

In a 25 turn run the prompt cache hit ratio reaches 98% and uncached input per turn falls to between 1,554 and 2,420 tokens, against 4,342 in a ten turn run. The cost of one social operation falls from 0.0111 to between 0.0025 and 0.0044.

Whatever limits diplomacy, it is not the price of a message. Any future tuning that suppresses talking to save money would be trading the wrong currency.

## Stability

Two 25 turn runs played concurrently, a 30 turn run, and twelve matrix runs have now completed with no turn lost and no session replaced. Earlier lost turns were the socket layer giving up after five minutes while the harness was still waiting; the harness keeps its own shorter deadline, clears the work it abandoned, and keeps the seat's session and its prompt cache. A seat server that cannot start sits the run out rather than taking the game down.

## What to test next

1. **Whether a crisis changes substance or only volume.** In flight: three seeds with a crisis against the three without, which the quality reading can now answer as a question about proposals and commitments rather than about message counts.
2. **Whether seats form a council now that it works.** The path is proven; whether they reach for it unprompted is not.
3. **Whether reputation forms from public words.** Do a seat's words cost it standing when they turn out to be false, or is standing only ever moved by its own posture actions?
4. **A grounded betrayal.** Play the treasury-emptying scenario so that a promise made inside the run is the promise that fails, and compare the reasoning against the run where the betrayal was narrated.

## Caveats

- The readings of what a message does are heuristics over wording, deliberately plain and inspectable. Every label can be checked against the message it came from.
- Three seeds shows that something works and is not enough to rank two things that are close.
- The seats sometimes reason about the harness. It reaches their private thinking and has never reached their messages.
- Sessions ran on deepseek-v4.1-flash throughout, so nothing here says how another model would behave.

