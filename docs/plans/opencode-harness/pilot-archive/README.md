# OpenCode Civ pilot archive

Before this harness existed, a separate experiment ran four OpenCode sessions as four
Civilization V civilizations in a real game, for over two hundred turns. It worked, and
it produced the only live-play evidence the project has. Nothing about it is hypothetical:
every number below was measured against a running game with a real bridge and a real MCP
server behind it.

That work lived on the `vox-deorum-opencode` branch, which was never merged and never
referenced from the plan. This folder is the part of it worth keeping in the main line:
the findings, the runbooks and one sample transcript. The branch itself remains on the
fork as the full archive, including the raw per-seat transcripts and telemetry, so the
receipts are one `git show` away rather than gone.

## What it proved

| Finding | Where it is recorded |
| --- | --- |
| A persistent session holds a warm prompt cache: 0.992 per turn in steady state, 1.7k fresh tokens against 212k re-read | [live/CACHE-COMPARISON.md](live/CACHE-COMPARISON.md) |
| The provider prefix expires after roughly 4 to 7 minutes idle, and costs a full re-read after that | [live/CACHE-COMPARISON.md](live/CACHE-COMPARISON.md) |
| Four seats played 213 turns of live Civ V with 57 model-initiated social operations, no operator prompting | [live/DIPLOMACY-FRESH4.md](live/DIPLOMACY-FRESH4.md) |
| The diplomacy was structural: a coalition room with one civ deliberately excluded, a mediation, and a collective retake of a captured city | [live/DIPLOMACY-FRESH4.md](live/DIPLOMACY-FRESH4.md) |
| No deals were proposed in 213 turns even though the deal tools were advertised | [live/DIPLOMACY-FRESH4.md](live/DIPLOMACY-FRESH4.md) |
| Reliable turn taking under a moving clock: 77 of 77 commits applied, missed epochs accounted for rather than dropped | [live/REVIEW-FRESH4.md](live/REVIEW-FRESH4.md) |
| A frozen identity plus frozen tool schemas is what keeps the cache warm, mechanically guarded | [live/RUNBOOK.md](live/RUNBOOK.md), [live/prefix-fingerprint.txt](live/prefix-fingerprint.txt) |

## What it got wrong, and what this harness kept instead

The pilot was built to answer one question, whether a persistent session beats
reconstructed per-turn prompts, and it answered it. It was never a product: its turn
router, its channel registry and its seat drivers are single-purpose scripts wired to one
machine, and its social transport was a file-backed dashboard beside the game rather than
the game itself.

Two things in this archive were carried into the main line rather than rewritten: the
world-channel transport (`broadcast-message`, `get-global-messages`, `get-game-status`),
which now lives in the MCP server, and the 0-based player-slot fix in the game launcher.
Everything else here is history, kept because a negative result and a measured number are
worth more to the next person than a memory of them.

## Reading order

1. [live/CACHE-COMPARISON.md](live/CACHE-COMPARISON.md) for the measured case for a persistent session.
2. [live/DIPLOMACY-FRESH4.md](live/DIPLOMACY-FRESH4.md) for what four model civilizations actually did to each other.
3. [live/REVIEW-FRESH4.md](live/REVIEW-FRESH4.md) for what it takes to keep that running reliably.
4. [live/SAMPLE-TRANSCRIPT.md](live/SAMPLE-TRANSCRIPT.md) for what one turn looks like from the inside.
5. [live/NIGHT-LOG.md](live/NIGHT-LOG.md) for the long night of fixing it, which is the honest part.

