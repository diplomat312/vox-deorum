# fresh4 replay corpus

This folder holds a replayable fixture built from a recorded Civilization V game
played by four OpenCode minds. The recording comes from the
experiments/opencode-civ-pilot pilot on the origin/vox-deorum-opencode branch.
The fixture keeps two things per turn: the exact observation handed to the model,
and the tool calls the model made in response. Nothing from telemetry or the live
game state is joined in yet.

## Scope

One game, labelled fresh4, and four seats:

| Seat | Civ | playerID | Turns recorded | Turn range | Commits | Passes |
| --- | --- | --- | --- | --- | --- | --- |
| korea | Korea | 0 | 53 | 1 to 211 | 32 | 21 |
| austria | Austria | 1 | 166 | 0 to 213 | 7 | 159 |
| siam | Siam | 2 | 196 | 0 to 213 | 46 | 150 |
| iroquois | Iroquois | 3 | 203 | 0 to 213 | 203 | 0 |

Each seat writes to its own file, fresh4/<seat>.jsonl. A seat records a turn only
when the harness gave it an opportunity to act, so turn numbers are sparse and no
turn number repeats within a seat.

## Source data

The recording lives under experiments/opencode-civ-pilot/live/ on the recording
branch, one directory per seat:

    runs-fresh4-austria/
    runs-fresh4-iroquois/
    runs-fresh4-korea/
    runs-fresh4-siam/

Each directory holds transcript-live.md, epochs.jsonl, telemetry-live.jsonl and
tool-calls.jsonl. Only transcript-live.md feeds this fixture. It is a
concatenation of turn sections. Each section opens with a heading like
"## Korea live turn 12 (session ses_...)" and then contains these subsections:

- "### Observation sent"
- "### Tool calls"
- "### Model words"
- "### Commit"
- "### Applied to live game"

The harvester maps Observation sent, Tool calls, Model words and Commit into the
record. Applied to live game records the results of pushing the committed actions
into the live game, so it stays out of the fixture.

## Record schema

One JSON object per line, keys in this order:

| Key | Type | Meaning |
| --- | --- | --- |
| game | string | Game label, fresh4. |
| seat | string | Civ name lowercased, for example korea. |
| playerID | integer or null | Seat index taken from the commit record. |
| turn | integer | Game turn. |
| session | string or null | OpenCode session id from the turn heading. |
| observation | string | Exact observation text, with only the surrounding blank lines removed. |
| toolCalls | array | Recorded calls as tool, input, output, error and status. |
| modelText | string or null | The model's final visible text, when recorded. |
| decision | string | commit, pass or none, read from the Commit section. |

Tool call output is capped at 4000 characters as a safety limit. No output in
this corpus comes close to that cap, so nothing is truncated in practice.

## Regenerating

From the repository root, run:

    node opencode-harness/scripts/harvest-corpus.mjs

The script needs the recording branch fetched locally. It reads every file
through git show and never checks the branch out, so the working tree is left
alone. Output is deterministic: two runs produce byte-identical files. The script
prints a per seat summary and exits non-zero when a turn section has no
observation text, so a broken transcript surfaces instead of silently losing a
turn.

The branch name sits in a single constant at the top of the script. Change that
constant to harvest a different run.

## Caveats

- Model words is present in every turn section but empty in all of them, so
  modelText is null for all 618 records. The recording captured the reasoning
  through tool calls and the commit rationale, not through a separate text block.
- Turn numbering is sparse and differs per seat. Korea's record is much thinner
  than the others: it starts at turn 1, skips turns 2 to 10 entirely, and has
  long gaps later in the game. Iroquois acted on 203 of the 214 turns.
- Turn 0 appears for Austria, Siam and Iroquois. It is a pre-game handshake turn
  with no cities founded yet, and the observation says so.
- Each seat uses one OpenCode session for the whole run, so session is constant
  per seat rather than per turn.
- Tool call records in the transcript also carry a callID, plus one stray
  followup field on a single Austria pass. The fixture schema drops both.
