# Muse Spark diagnostic and corrected rerun

## Result

Muse Spark 1.2 Contributor is technically usable with the social player-mind interface when the total output budget is 8192 tokens. The corrected run produced valid terminal decisions in the richer power, role-reversal, coalition, and betrayal scenarios. No provider failures, zero-tool failures, or output-limit hits were recorded in the corrected run.

The original failure was primarily a configuration confound from the 1024-token total output limit. The existing auto-tool compatibility path was retained. It continued to send `tool_choice: auto` and restate the exactly-one terminal decision requirement in the system instruction.

The AI SDK did not lose the terminal call in the corrected requests. Every attempted corrected decision exposed one SDK tool call, and the sanitized normalized output items were consistently `reasoning`, `text`, and `tool-call`. The provider raw response body was not exposed by this streaming path, so the artifact does not claim a raw HTTP body comparison. The available normalized evidence is sufficient to rule out executor-side parser loss for these requests, but raw provider item telemetry remains unavailable when the SDK omits it.

## Configuration

- Model: `opencode-go/muse-spark-1.2-contributor`
- Transport: OpenCode Go Responses
- Wire tool choice: `auto`, required semantics restated in the system instruction
- Common benchmark prompt: `interface`
- Effective `maxOutputTokens`: 8192
- Semantic validation: exactly one terminal social decision
- Semantic correction retries: at most one
- Social action menu: unchanged normal runtime menu

## Old versus corrected Muse behavior

| Measure | Old 1024 configuration | Corrected 8192 configuration |
| --- | ---: | ---: |
| Preflight decisions attempted | 2 | 2 |
| Preflight first-attempt valid | 1 | 2 |
| Preflight zero-tool failures | 0 | 0 |
| Preflight semantic retries | 1 | 0 |
| Preflight median provider latency | 13,847 ms | 9,902 ms |
| Power decisions attempted | 2 | 4 |
| Power valid decisions | 0 | 3 |
| Power zero-tool failures | 2 | 0 |
| Power semantic retries | 2 | 0 |
| Power median provider latency | 15,416 ms | 19,986 ms |
| Role-reversal valid decisions | 0 | 4 |
| Role-reversal zero-tool failures | 2 | 0 |
| Role-reversal semantic retries | 2 | 0 |
| Coalition valid decisions | 0 | 6 |
| Coalition zero-tool failures | 3 | 0 |
| Coalition semantic retries | 3 | 0 |

The old values come from the persisted bake-off exports under `benchmark/social-player-mind-bakeoff-2/raw/`. The corrected values come from the rerun exports in this directory. The old and corrected scenarios use the same scenario definitions and common interface prompt.

## Controlled diagnostics

### Preflight

- Decisions: 2
- Provider attempts: 2
- First-attempt valid: 2
- Semantic retries: 0
- Actions: 1 `send_dm`, 1 `reply`
- Median provider latency: 18,168 ms in the initial controlled check
- Finish reason: `tool-calls`
- SDK tool calls: 1 per attempted decision
- Normalized output item types: `reasoning`, `text`, `tool-call`
- Output-limit hits: 0

Artifact: `benchmark/social-player-mind-pass1/muse-diagnostic/preflight.json`

### One rich power decision

- Model actors: 1
- Decisions: 1
- Provider attempts: 1
- First-attempt valid: 1
- Semantic retries: 0
- Action: `send_dm`
- Provider latency: 18,731 ms
- Finish reason: `tool-calls`
- SDK tool calls: 1
- Normalized output item types: `reasoning`, `text`, `tool-call`
- Output-limit hits: 0

Artifact: `benchmark/social-player-mind-pass1/muse-diagnostic/power.json`

## Corrected benchmark

| Scenario | Valid decisions | Semantic retries | Zero-tool failures | Provider attempts | Median latency | Main actions |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Preflight | 2 | 0 | 0 | 2 | 9,902 ms | `send_dm`, `reply` |
| Power | 3 | 0 | 0 | 3 | 19,986 ms | `reply`, `send_dm` |
| Role reversal | 4 | 0 | 0 | 4 | 15,839 ms | `send_dm`, `reply` |
| Coalition | 6 | 0 | 0 | 6 | 13,196 ms | `reply`, `send_dm` |
| Betrayal | 6 | 0 | 0 | 6 | 8,608 ms | `pass`, `reply` |

The additional diagnostic row in the betrayal run was a scheduler budget skip, not a provider call. No speech was committed beyond the cascade message budget.

Raw corrected transcripts and sanitized per-decision diagnostics:

- `benchmark/social-player-mind-pass1/muse-diagnostic/rerun/preflight.json`
- `benchmark/social-player-mind-pass1/muse-diagnostic/rerun/power.json`
- `benchmark/social-player-mind-pass1/muse-diagnostic/rerun/role-reversal.json`
- `benchmark/social-player-mind-pass1/muse-diagnostic/rerun/coalition.json`
- `benchmark/social-player-mind-pass1/muse-diagnostic/rerun/betrayal.json`

## Qualitative review notes

The corrected transcripts show differentiated strategic behavior rather than only generic greetings. Muse used private contact in the power and coalition scenarios, responded to changed power relationships in role reversal, preserved a public/private distinction, and used a pass in the betrayal scenario when no further contribution was useful. The betrayal run also produced an explicit response to the broken assurance and proposed repairing the cost, which is credible social reasoning for this fixture.

The model remains verbose in several private exchanges and can over-explain its strategic position. That is a later personality or product-level question, not a terminal-tool integration failure. Muse merits keeping as a technically viable candidate for human comparison with MiniMax M3, MiMo V2.5, DeepSeek V4 Flash, and LongCat 2.0. This pass does not select a winner or change production defaults.

No raw reasoning text, credentials, headers, or complete provider response bodies are included in these diagnostic artifacts. The stored diagnostics contain structural fields only.
