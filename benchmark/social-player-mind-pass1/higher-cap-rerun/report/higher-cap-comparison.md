# Higher-cap finalist comparison

This is a follow-up to the Muse diagnostic. The four remaining finalist models were run independently with the same five existing scenario families, the same `interface` prompt variant, balanced pacing, and an effective 8192-token output limit. Muse's corrected run is recorded separately in `benchmark/social-player-mind-pass1/muse-diagnostic/rerun/`.

No model was assigned a subjective rank in this report. The transcripts are the authoritative material for human review.

## Aggregate mechanical results

| Model | Scenarios | Decisions | Provider attempts | First-attempt valid | Semantic retries | Runtime failures | Committed speech | PASS | Median latency | P95 latency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| MiniMax M3 | 5 | 24 | 20 | 20 | 0 | 0 | 17 | 3 | 3,083 ms | 16,467 ms |
| MiMo V2.5 | 5 | 24 | 19 | 19 | 0 | 0 | 17 | 2 | 13,422 ms | 28,767 ms |
| DeepSeek V4 Flash | 5 | 21 | 17 | 17 | 0 | 0 | 15 | 1 | 9,658 ms | 47,944 ms |
| LongCat 2.0 | 5 | 23 | 20 | 18 | 1 | 0 | 18 | 0 | 12,857 ms | 44,817 ms |

All four candidates used the 8192-token setting in every persisted result. No provider rate-limit, timeout, network, or other provider failure was recorded. Provider-reported token usage and cost were unavailable in these runs. No diagnostic reported output-limit exhaustion.

## Scenario results

| Model | Scenario | Decisions | Attempts | First valid | Semantic retries | Failures | Speech | PASS | Median latency | P95 latency | Main actions |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| MiniMax M3 | Preflight | 2 | 2 | 2 | 0 | 0 | 1 | 1 | 2,609 ms | 2,609 ms | reply, pass |
| MiniMax M3 | Power | 2 | 2 | 2 | 0 | 0 | 1 | 1 | 9,548 ms | 9,548 ms | send_dm, pass |
| MiniMax M3 | Role reversal | 5 | 4 | 4 | 0 | 0 | 4 | 0 | 2,724 ms | 3,512 ms | reply, send_dm |
| MiniMax M3 | Coalition | 8 | 6 | 6 | 0 | 0 | 5 | 1 | 3,083 ms | 4,574 ms | reply, pass, send_dm |
| MiniMax M3 | Betrayal | 7 | 6 | 6 | 0 | 0 | 6 | 0 | 6,797 ms | 16,467 ms | reply |
| MiMo V2.5 | Preflight | 2 | 2 | 2 | 0 | 0 | 1 | 1 | 9,365 ms | 9,365 ms | reply, pass |
| MiMo V2.5 | Power | 6 | 4 | 4 | 0 | 0 | 4 | 0 | 16,969 ms | 17,611 ms | reply, send_dm |
| MiMo V2.5 | Role reversal | 5 | 4 | 4 | 0 | 0 | 4 | 0 | 12,498 ms | 16,881 ms | reply, send_dm |
| MiMo V2.5 | Coalition | 6 | 5 | 5 | 0 | 0 | 4 | 1 | 16,322 ms | 17,389 ms | reply, send_dm, pass |
| MiMo V2.5 | Betrayal | 5 | 4 | 4 | 0 | 0 | 4 | 0 | 13,477 ms | 28,767 ms | reply |
| DeepSeek V4 Flash | Preflight | 2 | 2 | 2 | 0 | 0 | 1 | 1 | 2,166 ms | 2,166 ms | pass, reply |
| DeepSeek V4 Flash | Power | 5 | 4 | 4 | 0 | 0 | 4 | 0 | 8,523 ms | 9,658 ms | reply, send_dm |
| DeepSeek V4 Flash | Role reversal | 3 | 2 | 2 | 0 | 0 | 2 | 0 | 47,944 ms | 47,944 ms | send_dm |
| DeepSeek V4 Flash | Coalition | 6 | 5 | 5 | 0 | 0 | 4 | 0 | 8,917 ms | 12,122 ms | reply, send_dm |
| DeepSeek V4 Flash | Betrayal | 5 | 4 | 4 | 0 | 0 | 4 | 0 | 16,158 ms | 28,686 ms | reply |
| LongCat 2.0 | Preflight | 2 | 2 | 2 | 0 | 0 | 2 | 0 | 11,230 ms | 11,230 ms | send_dm, reply |
| LongCat 2.0 | Power | 5 | 4 | 4 | 0 | 0 | 4 | 0 | 19,228 ms | 20,897 ms | reply, send_dm |
| LongCat 2.0 | Role reversal | 5 | 5 | 3 | 1 | 0 | 4 | 0 | 14,506 ms | 44,817 ms | reply, send_dm |
| LongCat 2.0 | Coalition | 6 | 5 | 5 | 0 | 0 | 4 | 0 | 11,710 ms | 16,597 ms | reply, send_dm |
| LongCat 2.0 | Betrayal | 5 | 4 | 4 | 0 | 0 | 4 | 0 | 18,536 ms | 28,252 ms | reply |

## Qualitative review notes

### MiniMax M3

The fastest candidate in this run, with consistently valid terminal decisions. Its transcripts show direct public and private bargaining, coalition-prevention language, and adaptation when the power relationship reverses. It was more willing than the other candidates to pass in bounded situations. Some outputs are concise and formulaic, so transcript review should focus on whether that economy feels like a deliberate political style or limited depth.

### MiMo V2.5

Reliable structured decisions with moderate-to-high latency. It used both public replies and private contact, often framed around stability, autonomy, and transparency. The coalition and betrayal transcripts show useful sensitivity to private conversations and broken assurances. It can be verbose and sometimes repeats the same stability framing across turns.

### DeepSeek V4 Flash

Reliable and generally concise, with the largest latency outlier in role reversal. It used private messages for information and reassurance and maintained a clear distinction between public and private discussion. Its responses were less expansive than MiMo or LongCat in this sample, while still showing coherent adaptation to changed power and assurance conditions.

### LongCat 2.0

Reliable overall, with one semantic retry during role reversal and the slowest general response profile among the four. Its transcripts contained specific bargaining language, private outreach, and explicit boundary-setting in the betrayal scenario. It tended to produce longer, carefully qualified diplomatic messages. The main concern for later evaluation is latency and occasional first-attempt protocol failure, not provider availability.

These notes are preliminary human-review prompts, not automated quality scores. Full WORLD, DM, and group transcripts are stored beside each model's raw JSON results.

## Artifact paths

- MiniMax M3: `benchmark/social-player-mind-pass1/higher-cap-rerun/minimax-m3/`
- MiMo V2.5: `benchmark/social-player-mind-pass1/higher-cap-rerun/mimo-v2.5/`
- DeepSeek V4 Flash: `benchmark/social-player-mind-pass1/higher-cap-rerun/deepseek-v4-flash/`
- LongCat 2.0: `benchmark/social-player-mind-pass1/higher-cap-rerun/longcat-2.0/`
- Muse reference: `benchmark/social-player-mind-pass1/muse-diagnostic/rerun/`

The failed overlapping launch attempt was stopped and its disposable session was cleared before these sequential reruns. Its partial console output is not included as evidence, and the persisted files above were produced by the sequential runs.
