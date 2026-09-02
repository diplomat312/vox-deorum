/** Shared deterministic budget constants for plaintext civilization continuity. */

/** Estimated token count at which recent history should be compacted. */
export const RECENT_CHRONICLE_SOFT_TOKEN_LIMIT = 24_000;

/** Desired estimated token count after a successful compaction. */
export const RECENT_CHRONICLE_TARGET_TOKEN_LIMIT = 16_000;

/** Maximum estimated recent-history budget exposed to a normal wake. */
export const RECENT_CHRONICLE_HARD_TOKEN_LIMIT = 32_000;

/** Maximum size of the model-authored Current Outlook. */
export const MAX_OUTLOOK_CHARACTERS = 12_000;

/** Reserve predictable labels and separators added when Chronicle entries enter a prompt. */
export const CHRONICLE_RENDER_OVERHEAD_CHARACTERS = 80;

/** Convert plaintext size to the conservative token estimate used by continuity budgets. */
export function estimateCivilizationMemoryTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Estimate one Chronicle entry using the same plaintext rule as every continuity budget. */
export function estimateChronicleEntryTokens(entry: { text: string }): number {
  return estimateChronicleTokens([entry]);
}

/** Estimate a Chronicle sequence, including one predictable separator between entries. */
export function estimateChronicleTokens(entries: Array<{ text: string }>): number {
  if (entries.length === 0) return 0;
  const characters = entries.reduce((total, entry) => total + entry.text.length + CHRONICLE_RENDER_OVERHEAD_CHARACTERS, 0) + entries.length - 1;
  return Math.ceil(characters / 4);
}

/** Convert a token budget to its conservative character approximation. */
export function civilizationMemoryTokenCharacters(tokens: number): number {
  return tokens * 4;
}
