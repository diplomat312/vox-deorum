/**
 * @module utils/tools/tool-names
 *
 * Formatting helpers for tool-name lists. Deliberately free of agent/registry imports so both the
 * agent loop and provider middleware can share one rendering of "these tools" without the cycle
 * `agents -> models -> providers -> terminal-tools -> agent-registry -> agents` would create.
 */

/**
 * Formats a name list into a grammatical, backtick-quoted fragment:
 *   1 -> "`a`"   2 -> "`a` or `b`"   N -> "`a`, `b`, or `c`" (Oxford comma).
 * Returns undefined for an empty list.
 */
export function formatToolChoiceList(names: string[]): string | undefined {
  const q = names.map(n => `\`${n}\``);
  if (q.length === 0) return undefined;
  if (q.length === 1) return q[0];
  if (q.length === 2) return `${q[0]} or ${q[1]}`;
  return `${q.slice(0, -1).join(", ")}, or ${q[q.length - 1]}`;
}

/**
 * Builds the default continuation nudge for an agent from its completion tools: a one-sentence
 * reminder to finalize by calling one of them. Returns undefined for an empty list so the
 * injection site skips naturally.
 */
export function buildCompletionToolsNudge(names: string[]): string | undefined {
  const list = formatToolChoiceList(names);
  return list ? `Make sure to call ${list} following the EXACT provided format to finalize your decisions.` : undefined;
}
