# Direct OpenRouter capability check

This follow-up check used the local `OPENROUTER_API_KEY` without recording its value. It made five direct HTTP probes total while correcting local PowerShell error handling. The two reliable final responses are preserved in the raw JSON artifact below. No tools or SocialRuntime requests were used for this check.

| Model | Plain chat | HTTP status | Error code | Error message | Conclusion |
| --- | --- | ---: | --- | --- | --- |
| `meituan/longcat-2.0:free` | failed | 404 | 404 | unavailable for free, paid slug suggested | free endpoint unavailable |
| `deepseek/deepseek-v4-flash:free` | failed | 404 | 404 | unavailable for free, paid slug suggested | free endpoint unavailable |

Both responses explicitly direct callers to the paid slug. This settles the main uncertainty from the SocialRuntime preflight: the failures are not evidence of an incompatibility with `tool_choice: required`, because plain chat without tools already fails at the endpoint.

The `tools` with `auto` and `required` probes were intentionally not run. A plain-chat 404 makes those probes redundant and the brief capped this diagnostic at six calls or fewer.

The credentials and local social server were present and reachable during the check. No candidate roster was changed, no paid model was called, and no Stage B social screen was started.
