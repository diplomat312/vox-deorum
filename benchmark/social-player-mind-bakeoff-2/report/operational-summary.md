# Operational summary

| Condition | Model | Scenario | Decisions | First-attempt valid | Semantic retries | Provider attempts | Provider retries | Provider failures | Median provider latency | Median cascade duration |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| Condition C / run 1 | openrouter/google/gemma-4-31b-it:free | preflight | 2 | 0 | 0 | 6 | 4 | {"rate-limit":2,"timeout":0,"network":0,"other":0} | 3790 ms | 3798 ms |
| Condition F / run 1 | opencode-go/longcat-2.0 | preflight | 2 | 2 | 0 | 2 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":0} | 86254 ms | 86262 ms |
| Condition B / run 1 | opencode-go/muse-spark-1.2-contributor | preflight | 2 | 1 | 1 | 3 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":0} | 13847 ms | 13856 ms |
| Condition H / run 1 | opencode-go/mimo-v2.5 | preflight | 2 | 2 | 0 | 2 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":0} | 13602 ms | 13611 ms |
| Condition A / run 1 | openrouter/minimax/minimax-m2.7:free | preflight | 2 | 2 | 0 | 2 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":0} | 7282 ms | 7289 ms |
| Condition D / run 1 | opencode-go/deepseek-v4-flash | preflight | 2 | 2 | 0 | 2 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":0} | 2263 ms | 2271 ms |
| Condition G / run 1 | openrouter/minimax/minimax-m3:free | preflight | 2 | 2 | 0 | 2 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":0} | 4319 ms | 4326 ms |
| Condition E / run 1 | openrouter/thinkingmachines/inkling:free | preflight | 2 | 0 | 0 | 2 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":2} | 48 ms | 55 ms |
| Condition H / run 1 | opencode-go/mimo-v2.5 | power | 5 | 4 | 0 | 4 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":0} | 7940 ms | 32136 ms |
| Condition A / run 1 | openrouter/minimax/minimax-m2.7:free | power | 6 | 5 | 0 | 5 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":0} | 13412 ms | 73843 ms |
| Condition D / run 1 | opencode-go/deepseek-v4-flash | power | 3 | 2 | 0 | 2 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":0} | 92732 ms | 103819 ms |
| Condition G / run 1 | openrouter/minimax/minimax-m3:free | power | 5 | 4 | 0 | 4 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":0} | 10712 ms | 38590 ms |
| Condition B / run 1 | opencode-go/muse-spark-1.2-contributor | power | 2 | 0 | 2 | 4 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":0} | 15416 ms | 30415 ms |
| Condition F / run 1 | opencode-go/longcat-2.0 | power | 6 | 4 | 0 | 4 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":0} | 16126 ms | 50617 ms |
| Condition G / run 1 | openrouter/minimax/minimax-m3:free | reversal | 6 | 5 | 0 | 5 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":0} | 6555 ms | 45647 ms |
| Condition H / run 1 | opencode-go/mimo-v2.5 | reversal | 5 | 4 | 0 | 4 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":0} | 10276 ms | 38942 ms |
| Condition F / run 1 | opencode-go/longcat-2.0 | reversal | 6 | 4 | 0 | 4 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":0} | 35281 ms | 68182 ms |
| Condition A / run 1 | openrouter/minimax/minimax-m2.7:free | reversal | 2 | 0 | 0 | 2 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":2} | 759 ms | 1156 ms |
| Condition D / run 1 | opencode-go/deepseek-v4-flash | reversal | 5 | 4 | 0 | 4 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":0} | 7766 ms | 32592 ms |
| Condition B / run 1 | opencode-go/muse-spark-1.2-contributor | reversal | 2 | 0 | 2 | 4 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":0} | 19555 ms | 35108 ms |
| Condition D / run 1 | opencode-go/deepseek-v4-flash | coalition | 8 | 6 | 1 | 8 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":0} | 11126 ms | 90058 ms |
| Condition G / run 1 | openrouter/minimax/minimax-m3:free | coalition | 9 | 8 | 0 | 8 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":0} | 4763 ms | 33949 ms |
| Condition F / run 1 | opencode-go/longcat-2.0 | coalition | 8 | 7 | 0 | 7 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":0} | 17646 ms | 104932 ms |
| Condition B / run 1 | opencode-go/muse-spark-1.2-contributor | coalition | 3 | 0 | 3 | 6 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":0} | 26622 ms | 76890 ms |
| Condition H / run 1 | opencode-go/mimo-v2.5 | coalition | 10 | 7 | 1 | 9 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":0} | 16254 ms | 83087 ms |
| Condition D / run 1 | opencode-go/deepseek-v4-flash | betrayal | 7 | 6 | 0 | 6 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":0} | 14106 ms | 105994 ms |
| Condition H / run 1 | opencode-go/mimo-v2.5 | betrayal | 9 | 7 | 0 | 7 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":0} | 18024 ms | 106945 ms |
| Condition F / run 1 | opencode-go/longcat-2.0 | betrayal | 5 | 2 | 1 | 4 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":0} | 28439 ms | 103257 ms |
| Condition G / run 1 | openrouter/minimax/minimax-m3:free | betrayal | 9 | 8 | 0 | 8 | 0 | {"rate-limit":0,"timeout":0,"network":0,"other":0} | 6234 ms | 41723 ms |
