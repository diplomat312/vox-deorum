# The generated-world benchmark

Four OpenCode seats and one person's seat play a generated world with no Civilization V.
The world is the simulation the harness already had, plus the border, the army and the war it
was missing. A scripted circumstance sets up the experiment, and the run is reduced to
numbers so a question can be asked across seeds rather than answered by whichever run had
the best conversation.

```
npx tsx vox-agents/scripts/simulated-benchmark.ts --seed 31 --turns 12 --minutes 40 \
  --script script.json --out runs-sim/seed-31
npx tsx vox-agents/scripts/simulated-benchmark.ts --seed 31 --reuse --out runs-sim/seed-31
```

The script file is a list of circumstances, which is what makes a run an experiment:

```json
[{ "turn": 3, "order": "mass_troops", "seat": "austria",
   "args": { "facing": "korea", "committed": 0.8 } }]
```

`--reuse` re-measures a run from its own store without replaying it. That is what makes a fix
to a reading verifiable: the transcript a reader got wrong is still on disk, so the corrected
reading applies to the same game rather than to a different one.

## What a run looks like

Seed 31, twelve turns, three scripted massings. Nine messages, seven of them private, across
three private channels. One seat never spoke.

The shape of the diplomacy was: Austria massed on Korea's border; Korea asked Austria what it
was for; Austria withdrew and explained; Korea credited the withdrawal in private. Then Siam
massed on Austria; Korea noticed that too and asked Siam about its intentions toward a third
party, which is a seat gathering intelligence rather than defending itself. Austria answered
Siam publicly, named the promise it had kept, refused the implied ask, and offered a mutual
non-aggression pact. Siam withdrew and said so before the table.

## The reading was wrong, and this is the correction

The first version of the measure reported **zero accusations and zero warnings**, and one
question about intent. Reading the transcript showed that to be false: message 8 contains
"any attack on my land will be met, and the whole table will know who moved first" and "if it
is territory, the answer is no", and message 2 says "tell me your intent, honestly" with no
question mark at all.

Corrected against the same game, with no new play:

| Measure | First reading | Corrected |
| --- | --- | --- |
| Questions about intent | 1 | 5 |
| Accusations | 0 | 2 |
| Warnings | 0 | 2 |

The models asked about intent in the imperative about as often as in the interrogative, and
they warned by describing a consequence rather than by threatening one. A reader that counts
question marks and threats reports a placid table that does not exist.

**This is the same lesson as the private-mind reader in the harness**, which found five
readings on a real run and was wrong about all five. Both times the instrument was the thing
that needed fixing, and both times the fix was found by reading the transcript it had
misread. Every miss is now a test, using the sentences verbatim.

## What to measure next

## Two seeds, two shapes

Same script, same four seats, same model, twelve turns each.

| Measure | Seed 31 | Seed 32 |
| --- | --- | --- |
| Messages | 9 | 10 |
| Public | 2 | 4 |
| Private | 7 | 6 |
| Private channels | 3 | 4 |
| Questions about intent | 5 | 6 |
| Proposals | 4 | 5 |
| Commitments | 5 | 7 |
| Accusations | 2 | 0 |
| Warnings | 2 | 4 |
| A group opened | no | **yes, twice** |

The volume is nearly identical and the shape is not. Seed 31 kept almost everything private
and produced two flat accusations. Seed 32 went public, produced no accusations and four
warnings instead, and **opened a group**, which seed 31 never did. In seed 32 a seat also
argued from the sequence of events rather than from the act: Korea told the table that
Austria had moved an army "one day after Korea publicly renounced first strikes and offered a
mutual non-aggression pact", which is a seat using time as evidence.

Two runs is not a distribution, and this is the point of the benchmark rather than a result
from it. What it does show is that the differences worth measuring are not in how much the
seats talk, which barely moves, but in the shape: private against public, warning against
accusation, and whether anyone reaches for an institution.

- Whether **private channels dominate** the way seed 31 suggests, and whether that is a
  property of the models or of the environment. Seven of nine messages were private, and the
  stakes were public.
- Whether **accusation and warning scale with the pressure**. Three massings produced two of
  each. Do more incidents produce more, or does the table settle into a norm?
- Whether **any of it changes who wins**. Nothing measured so far connects a conversation to
  a score, and that connection is the actual claim the environment was built to test.
