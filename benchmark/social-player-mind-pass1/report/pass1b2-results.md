# Pass 1B.2 results

## 1. Runtime state

- Provider compatibility branch: `codex/social-provider-compat-pass1b1`
- Compatibility SHA: `4eb0f034`
- Benchmark harness SHA: `a32a388e`
- Runtime changes after benchmark start: none
- Four conditions used one candidate model for both Aurelia and Borin. Earlier Pass 1B evidence was preserved.

## 2. Muse compatibility

- Wire tool choice: `auto`
- Function schemas: relaxed strictness for the Muse Responses path only; runtime semantic validation remains exactly one valid social decision.
- Completion cardinality: `exactly-one` for social execution, while the shared middleware default remains `one-or-more`.
- Live smoke: accepted the normalized request and produced one valid reply after one semantic retry. The smoke used two provider attempts, 13,113 ms provider latency, and a 13,129 ms completed cascade.

## 3. Endpoint status

| Model | Provider | Preflight or smoke | Result |
| --- | --- | --- | --- |
| Muse Spark 1.2 Contributor Free | OpenCode Zen Responses | One bounded live smoke | Operational, valid reply after one semantic retry |
| MiniMax M2.7 Free | OpenRouter | Tiny condition | Operational, two DM actions |
| MiMo V2.5 Free | OpenCode Zen Chat Completions | Tiny condition | Two rate-limit failures, no committed model message |
| MiniMax M3 Free | OpenRouter | Tiny condition | Operational, two DM actions |

## 4. Blind operational summary

The raw machine-readable export is `../raw/stage-b/pass1b2-results.json`. Latency and queue values below are medians from the available diagnostics. The current harness export does not retain each individual diagnostic row, so no per-row latency is inferred here.

| Condition | Attempts | Provider retries | Semantic retries | Latencies | Cascade duration | Public messages | Private actions | Errors |
| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- |
| A | 3 | 0 | 1 | provider median 18,087 ms; queue median 6,905 ms | 24,995 ms | 1 | 0 | 1 semantic invalid-output diagnostic, then valid reply |
| B | 2 | 0 | 0 | provider median 14,871 ms; queue median 11,502 ms | 26,380 ms, exhausted at message cap | 0 | 2 DMs | none |
| C | 6 | 4 | 0 | provider median 3,820 ms; queue median 3,757 ms | 33,760 ms, exhausted | 0 | 0 | 2 rate-limit failures |
| D | 2 | 0 | 0 | provider median 7,096 ms; queue median 4,989 ms | 12,091 ms, exhausted at message cap | 0 | 2 DMs | none |

## 5. Transcript paths

- [Condition A](../blind/pass1b2/condition-a.md)
- [Condition B](../blind/pass1b2/condition-b.md)
- [Condition C](../blind/pass1b2/condition-c.md)
- [Condition D](../blind/pass1b2/condition-d.md)

The actual mapping is kept separately in `../mapping/pass1b2-condition-mapping.json` and is not reproduced in this blinded report.

## 6. Neutral observations

### Condition A

- Aurelia produced one public reassurance.
- Muse required one semantic retry before producing a valid reply.
- No private room was created.

### Condition B

- No public model message was committed.
- Aurelia opened a DM with Borin.
- Borin opened a DM with Human.

### Condition C

- No model message was committed.
- Two provider attempts ended in HTTP 429 `FreeUsageLimitError` responses.
- The condition exhausted without a social action.

### Condition D

- No public model message was committed.
- Aurelia opened a DM with Borin.
- Borin opened a DM with Human.

## 7. Request ledger

The authoritative request count is provider-attempt telemetry, not cascade `modelRuns`.

- Tiny benchmark: 13 provider attempts.
- Muse smoke: 2 provider attempts.
- Total Pass 1B.2 attempts: 15.
- Detailed ledger: `../request-ledger-pass1b2.json`.

## 8. Problems

### Provider compatibility

- Muse’s final provider path is operational with `auto`, relaxed wire schemas, and exactly-one runtime validation.
- MiMo remained unchanged and produced rate-limit failures during its condition. No MiMo workaround was added.

### Quota and rate limit

- MiMo recorded two HTTP 429 `FreeUsageLimitError` failures across six attempts.

### Model semantic reliability

- Muse produced one invalid-output result before its valid retry. The runtime rejected the invalid result and did not translate prose into an action.

### Latency

- M2.7 had a 26,380 ms cascade and M3 had a 12,091 ms cascade. Both completed their bounded conditions.

### Benchmark/runtime defect

- The benchmark raw export currently retains aggregate latency and queue summaries, not every individual diagnostic row. The exact provider-attempt count is retained in the ledger and raw metrics.

No ranking or winner was assigned. No second scenario, Go comparison, stress run, or Civ gameplay work was started.
