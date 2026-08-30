/** Normalize model text before it becomes user-visible social speech. */
export function normalizeSocialOutput(raw: string): string | undefined {
  let content = raw.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').replace(/<\|[^>]+\|>/g, '').trim();
  const toolMessage = content.match(/\[(?:message|content)\s*=\s*["']([^"']*)/i);
  if (toolMessage?.[1]) content = toolMessage[1].trim();
  content = content.replace(/^```(?:text|markdown)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (!content) return undefined;
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
