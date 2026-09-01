# Muse prompt calibration

## Runtime

- Branch: `codex/social-provider-compat-pass1b1`
- Calibration endpoint: `opencode-go/muse-spark-1.2-contributor` using Responses transport.
- Runtime and provider behavior: unchanged during the experiment.
- Prompt mapping: `../mapping/prompt-mapping.json`

## Stage 1, tool-compliance screen

Each prompt ran twice with one Muse actor and one human. The median is the conventional median of the two recorded decision latencies.

| Prompt | Decisions | First-attempt valid | Semantic retries | Provider attempts | Median latency |
| --- | ---: | ---: | ---: | ---: | ---: |
| A | 2 | 2/2 (100%) | 0 | 2 | 4,891.5 ms |
| B | 2 | 2/2 (100%) | 0 | 2 | 3,768.5 ms |
| C | 2 | 1/2 (50%) | 1 | 3 | 6,605 ms |

All accepted decisions were `reply`. No multiple terminal actions were observed. Prompt C had one prose or zero-terminal-call semantic retry, followed by a valid reply.

## Stage 2, political screen

Each condition used Aurelia and Borin with the same Muse Go model and one exact political stimulus. No follow-up prompt was used.

| Prompt | Decisions | First-attempt valid | Semantic retries | Provider attempts | Median latency | Cascade | Actions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| A | 2 | 0/2 | 2 | 4 | 19,257 ms | 36,264 ms, completed | none |
| B | 2 | 0/2 | 2 | 4 | 15,352 ms | 27,931 ms, completed | none |
| C | 3 | 0/3 | 2 | 4 | 17,750 ms | 34,993 ms, exhausted | one `send_dm` |

Prompt A and Prompt B produced no committed model action in this exact situation after bounded semantic retries. Prompt C produced one private reassurance from Aurelia to Borin. No provider failures, rate limits, or transport failures were recorded in Stage 2.

## Tool-failure classification

- Prompt A Stage 2: two zero-terminal-call semantic failures, followed by no accepted action.
- Prompt B Stage 2: two zero-terminal-call semantic failures, followed by no accepted action.
- Prompt C Stage 1: one zero-terminal-call semantic retry, then a valid reply.
- Prompt C Stage 2: two zero-terminal-call semantic failures and one accepted `send_dm` action.
- No multiple-terminal-call, invalid-schema, or provider-failure result was observed in this calibration.

## Recommendation

These are calibration labels, not production rankings.

| Prompt | Tool reliability | Political behavior |
| --- | --- | --- |
| Baseline | better | similar |
| Decision-interface | worse | better |
| Decision-interface plus strategic identity | similar | similar |

The common bake-off prompt is the concise decision-interface variant. It is selected because it was the only variant to produce an interpretable private political action in the exact Stage 2 situation, while the strategic-identity addition showed no benefit and added no reliable political differentiation. This prompt remains benchmark-only and is not being installed as the global SocialRuntime default.

## Common benchmark prompt

The behavioral prompt appended to every candidate's profile is:

> OUTPUT CONTRACT: Complete this turn by calling exactly one available terminal action tool. Put any dialogue you want to send inside that tool's arguments. Do not answer with ordinary prose outside the tool call. Do not call more than one terminal action. If taking no social action is best, use the pass action.

The Aurelia, Borin, and later actor profiles remain common across candidates. Provider-specific wire normalization is unchanged and is not a behavioral advantage.

## Transcript paths

- [Prompt A](../blind/prompt-a.md)
- [Prompt B](../blind/prompt-b.md)
- [Prompt C](../blind/prompt-c.md)

The raw per-run exports are in `../raw/`. The short-stimulus Prompt A Stage 2 run is retained separately as `prompt-a-stage2-short-stimulus.json` and is not part of the exact-stimulus comparison.
