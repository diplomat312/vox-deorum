# Benchmark Pass 1, early stop

The frozen runtime baseline was used without source changes. Stage A stopped after two independent candidates failed their bounded preflight, as required by the brief. Stage B was not run.

## Endpoint results

| Condition | Requested reference | Resolution | Attempts | Provider retries | Semantic retries | Latency | Valid tool call | Result |
| --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- |
| Condition A | `openrouter/meituan/longcat-2.0:free` | exact | 1 | 0 | 0 | 454 ms | no | PREFLIGHT FAILED |
| Condition B | `openrouter/deepseek/deepseek-v4-flash:free` | exact | 1 | 0 | 0 | 509 ms | no | PREFLIGHT FAILED |
| Condition C | `opencode/mimo-v2.5-free` | not attempted | 0 | 0 | 0 | n/a | n/a | not reached |
| Condition D | `opencode/muse-spark-1.2-contributor-free` | not attempted | 0 | 0 | 0 | n/a | n/a | not reached |

Both attempted endpoints resolved to the requested provider and chat-completions transport. Each produced one terminal `other` provider failure diagnostic, no valid structured action, no PASS, and no committed model speech. The benchmark’s sanitized output does not include the provider error text, so the exact upstream rejection cannot be distinguished further here.

## Request ledger

| Provider | Actual provider attempts |
| --- | ---: |
| OpenRouter, LongCat 2.0 | 1 |
| OpenRouter, DeepSeek V4 Flash | 1 |
| OpenCode Zen | 0 |
| Total | 2 |

## Stage B and blinding

No candidate passed Stage A, so no tiny social screen was started. There are no blind transcripts or condition mapping artifacts for this stopped pass.

## Operational classification

- Provider/runtime result: both OpenRouter requests reached the social runtime and produced terminal `other` failures after one attempt.
- Benchmark behavior: settlement completed normally and the script returned the sanitized failure metrics without retrying indefinitely.
- Evidence limitation: the current benchmark result exposes the failure class but not the sanitized terminal error detail.
