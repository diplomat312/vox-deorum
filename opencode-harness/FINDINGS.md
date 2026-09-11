# Findings

What the simulated runs have shown about getting model seats to engage in diplomacy, and what each result implies for the next change.

Every run below plays the same four seats (Korea, Austria, Siam, Iroquois) on the same generated world from seed 11, so the seats face the same circumstances unless a variant says otherwise. A seat turn is one seat playing one turn; a 25 turn game with four seats is 100 seat turns.

## The runs so far

| Run | Turns | Variant | Social operations | Direct | World | Silent seats | Longest silence | Direct reply rate | Cache hit | Cost per social operation | Turns lost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| base1 | 10 | none | 4 | 0 | 4 | 0 | 8 | 0% | 95% | 0.0111 | 0 |
| brief1 | 10 | standing briefing | 4 | 0 | 4 | 0 | 8 | 0% | 95% | 0.0123 | 1 |
| coach1 | 10 | coaching | 7 | 0 | 7 | 0 | 8 | 0% | 95% | 0.0075 | 3 |
| crisis2 | 25 | coaching plus two injected crises | 46 | 25 | 21 | 0 | 5 | 100% | 97.9% | 0.0025 | 2 |

## Hypothesis 1: the seats stay silent because nothing asks them to speak

The first run produced four social operations across forty seat turns, all of them the same move: a public greeting on the opening turn. Reading the seats' own reasoning showed the deliberation rather than an inability. Korea, weighing whether to write to Austria:

> Let me also maybe send a friendly message to Austria? Not necessary. I could send a diplomatic greeting but it's early. I'll keep it simple. Maybe a world message isn't warranted.

That is a seat that knows how to talk, considers it, finds no reason that survives contact with the decision, and passes. Silence is the default because nothing in the situation creates a need to speak.

## Hypothesis 2: showing a seat the state of its contact would change it

Refuted, cleanly. The standing briefing variant adds a section naming, for each other seat, whether they have been in touch, what the seat has sent them privately, and the fact that a direct message is not overheard.

The result was identical to the baseline in every measure: four operations, all world messages, no direct messages, the same longest silence of eight turns. Handing a seat more information about its relationships does not make it act on them.

## Hypothesis 3: the deliberation is the lever, not the information

Supported, but only within one register. The coaching variant closes each observation by stating what dialogue does: that what a seat says becomes its reputation, that a direct message is private, that a seat which wrote to you is waiting, and that saying nothing is also a decision.

Social operations rose from four to seven across the same forty seat turns, with two seats doubling their output. Cost per social operation fell from 0.0111 to 0.0075, because a ninth message costs almost nothing on a warm session.

Two costs came with it. The longer closing made turns slower, and three turns of forty failed to finish against none before. And the extra messages were still all public greetings: the register did not change, only the volume.

## Hypothesis 4: private channels are used when there is private business

Supported, and this is the clearest result so far. A 25 turn run with coaching and two injected circumstances, a broken promise on turn 12 and a military build-up on turn 18, produced 46 social operations, 25 of them direct messages. Every earlier run produced zero direct messages. Every direct pair that exchanged messages got an answer in kind, so the private graph was fully reciprocated, and five of the six possible pairs were active.

The behaviour is the interesting part, because nobody was told to do any of it.

Siam noticed the Iroquois build-up and became a mediator on its own initiative. It warned the Iroquois privately, told it plainly that the levy had been noticed and that quieter courts were uneasy, asked for a calm word it could carry, then carried the Iroquois' assurance to every other court in public, and Korea thanked it for doing so. The Iroquois answered in the open that its arms were for defence alone. A reassurance cycle between three seats, started by a fourth seat reading a military number and deciding the table needed settling.

Korea, on learning that Austria had broken its word, reasoned explicitly about the shape of its response: public denunciation to damage Austria's standing, a private demand for an explanation, or a measured public note that leaves Korea as the wronged party without escalating. It chose the measured note and changed its posture toward Austria, and its next turn opened with the relationship having moved to Hostile.

Cost per social operation fell to 0.0025, roughly a fifth of the baseline, because a warm session makes each additional message nearly free. This matters for tuning: at 98% cache, discouraging diplomacy to save money is wrong by an order of magnitude.

## Hypothesis 5: making deals available turns talk into commitments

Open. The deal layer now exists as three further operations inside the same communicate tool, proposals carry gold, gold per turn or a resource, and the world pays what is promised. A deal that promises gold per turn keeps paying for ten turns and then ends, so a promise has a cost and a duration.

The comparison is in flight: the same 25 turns, the same seed, the same scenario and the same coaching, with deals available where crisis2 did not have them. The question is whether a table that already talks this much will convert talk into binding trades, and whether the offers are honoured or rejected.

## What to test next

- Does a crisis manufacture diplomacy, or does any long game? The 25 turn run is confounded by length and by its two shocks. A second long run with no shocks would separate them, and the answer decides whether to design scenarios or just play longer.
- How should a circumstance be phrased? Korea's reasoning showed it noticing the seam: it described the broken promise as a scripted crisis and wondered whether it was being tested. A shock written as in-world rumour rather than as system narration may keep the table inside the fiction.
- Does the reciprocated private graph survive fifty turns, or do pairs go quiet once they have said their piece? Durability is one of the five qualities worth measuring, and the current longest run cannot answer it.
- Is a seat's reputation actually formed from what other seats say in the open, or only from its own actions? The posture action exists and seats used it, but nothing yet shows a seat's public words costing it standing.

## Caveats worth carrying

- Two turns in a hundred failed on a stalled model call. Both recovered by clearing the stalled work, and neither seat's session or prompt cache was lost, which is why crisis2 shows zero session resets.
- The seats sometimes read the harness rather than the world. Korea's reasoning referred to the simulation and to a scripted crisis, which is a small leak between the game fiction and the machinery around it.
- One seat turn in crisis2 never reached a decision at all. An unfinished turn is recorded rather than retried, so a run can be read for how often seats simply fail to decide.
- These are single runs with four seats. A difference of a few social operations between variants is suggestive, not settled, and the numbers above should be read as direction rather than measurement.

