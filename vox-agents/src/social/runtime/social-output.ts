/** Normalize and validate one actor's user-visible social speech. */
export function normalizeSocialOutput(raw: string, actorNames: string[] = []): string | undefined {
  let content = raw.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').replace(/<\/?think>/gi, '').replace(/<\|[^>]+\|>/g, '').trim();
  const toolMessage = content.match(/\[(?:message|content)\s*=\s*["']([^"']*)/i);
  if (toolMessage?.[1]) content = toolMessage[1].trim();
  content = content.replace(/^```(?:text|markdown)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (!content) return undefined;
  if (/^NO_RESPONSE\b/i.test(content)) return undefined;
  const labels = actorNames.filter(Boolean).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (labels.length && new RegExp(`(?:^|\\n)\\s*(?:\\[[^\\]]+\\]|(?:${labels.join('|')})\\s*:)`, 'i').test(content)) return undefined;
  if (/\[[a-z0-9_-]+\]\s*(?:&\s*\[[a-z0-9_-]+\])?/i.test(content)) return undefined;
  if (/^(?:assistant|system|user)\s*:/i.test(content)) return undefined;
  if (/(?:^|\n)\s*\*[^*\n]+\*\s*/.test(content)) return undefined;
  const metaPatterns = [
    /the context suggests/i,
    /the assistant should respond/i,
    /the user has sent me/i,
    /the appropriate response is ready/i,
    /looking at the history of our interaction/i,
    /i will craft a concise response/i,
  ];
  if (metaPatterns.some((pattern) => pattern.test(content))) return undefined;
  return content;
}
