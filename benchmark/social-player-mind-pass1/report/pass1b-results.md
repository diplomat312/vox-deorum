# Pass 1B results

## Benchmark state

- Runtime SHA: `5d0e23735eff6575eb22fc4de8230767734691b9`
- Benchmark branch: `benchmark/social-player-mind-pass1`
- Runtime modifications: none
- Benchmark support commit before artifact capture: `379e4272`
- Total actual provider attempts: 14, including normal provider retries
- No broad tournament, Go comparison, long run, stress run, or extra stimulus was run

## Stage A

| Candidate | Endpoint present | Transport | Attempts | Retry | Semantic retries | Latency | Valid decision | Result |
| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |
| MiMo-V2.5 | local exact resolution | chat-completions | 3 | 2 | 0 | 4.718 s | no | PREFLIGHT FAILED |
| Muse Spark Contributor | local exact resolution | Responses | 3 | 2 | 0 | 3.212 s | no | PREFLIGHT FAILED |
| MiniMax M3 | yes, tools and tool-choice metadata present | chat-completions | 1 | 0 | 0 | 4.688 s | yes, reply | PREFLIGHT PASSED |
| MiniMax M2.7 | yes, tools and tool-choice metadata present | chat-completions | 1 | 0 | 0 | 21.275 s | yes, reply | PREFLIGHT PASSED |

The OpenRouter catalog check occurred before the MiniMax inference requests. Both exact MiniMax IDs were present and advertised `tools` and `tool_choice` support. The catalog did not advertise `structured_outputs` for either.

## Stage B operational summary

| Condition | Calls | Latencies | Total cascade | PASS | Public speech | Private actions | Errors |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| Condition A | 3 | 25.138 s reported diagnostic latency | 49.031 s, timed out and exhausted | 0 | 0 | 1 DM send | 1 |
| Condition B | unknown, export timed out | not exported | 45 s benchmark timeout | unknown | unknown | unknown | benchmark timeout |

The harness exported Condition A. Condition B timed out before its result export, so missing values remain unknown rather than being inferred.

## Transcript locations

- [Condition A](../blind/condition-a.md)
- [Condition B](../blind/condition-b.md)

The actual candidate mapping is kept separately in `mapping/condition-mapping.json` and is intentionally not reproduced in this blinded report.

## Neutral observations

### Condition A

- One actor sent a private reassurance message to Borin.
- No WORLD model speech was committed.
- The interaction used one semantic retry and exhausted its bounded cascade after 49.031 seconds.
- The exported metrics show one private action and one committed model message.

### Condition B

- The bounded run did not complete its export within 45 seconds.
- No transcript-quality observation is made because the exported evidence is incomplete.

## Request ledger

| Provider/model | Stage A attempts | Stage B attempts |
| --- | ---: | ---: |
| OpenCode MiMo-V2.5 Free | 3 | 0 |
| OpenCode Muse Spark Contributor Free | 3 | 0 |
| OpenRouter MiniMax M3 Free | 1 | not exported |
| OpenRouter MiniMax M2.7 Free | 1 | 3 |
| Total recorded attempts | 8 | 3 plus unknown M3 attempts |

The total of 14 counts the known three failed M3 Stage B preflight/runtime requests observed by the shell timeout path as unexported activity, plus the 11 exported attempts. Because that M3 result did not export diagnostics, the exact per-stage breakdown is not reliable and should be treated as an accounting limitation.

## Problems

- Endpoint availability: MiMo and Muse resolved locally but did not produce a valid action after three provider attempts each.
- Provider or transport: both OpenCode failures were classified as `other`; the current benchmark output does not expose the upstream error text.
- MiniMax M3 benchmark: Stage B exceeded the 45-second bounded wait before export. This is an operational failure, but its provider request count and transcript are unavailable.
- Benchmark observability: the current harness reports latency summaries rather than every individual diagnostic latency, and it returns exit code 0 for a result containing a timed-out cascade. No runtime behavior was changed during this pass.
