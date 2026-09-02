/** Shared deterministic budget constants for plaintext civilization continuity. */

/** Estimated token count at which recent history should be compacted. */
export const RECENT_CHRONICLE_SOFT_TOKEN_LIMIT = 24_000;

/** Desired estimated token count after a successful compaction. */
export const RECENT_CHRONICLE_TARGET_TOKEN_LIMIT = 16_000;

/** Maximum estimated recent-history budget exposed to a normal wake. */
export const RECENT_CHRONICLE_HARD_TOKEN_LIMIT = 32_000;

/** Maximum size of the model-authored Current Outlook. */
export const MAX_OUTLOOK_CHARACTERS = 12_000;

/** Convert plaintext size to the conservative token estimate used by continuity budgets. */
export function estimateCivilizationMemoryTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Convert a token budget to its conservative character approximation. */
export function civilizationMemoryTokenCharacters(tokens: number): number {
  return tokens * 4;
}
