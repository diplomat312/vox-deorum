import type { SocialCascadeBudget, SocialPacingProfile } from '../types.js';

export type { SocialPacingProfile } from '../types.js';

/** Return a bounded cascade budget scaled to the number of model actors. */
export function getSocialPacingBudget(profile: SocialPacingProfile = 'balanced', actorCount = 3): SocialCascadeBudget {
  const modelCount = Math.max(1, actorCount);
  if (profile === 'quiet') return { maxModelRuns: Math.max(2, Math.min(4, modelCount)), maxCommittedModelMessages: Math.max(2, Math.min(4, modelCount)), maxRepliesPerActor: 1, maxWallClockMs: 30_000 };
  if (profile === 'lively') return { maxModelRuns: Math.max(6, Math.min(16, modelCount * 3)), maxCommittedModelMessages: Math.max(8, Math.min(10, modelCount * 2)), maxRepliesPerActor: 3, maxWallClockMs: 90_000 };
  return { maxModelRuns: Math.max(5, Math.min(10, modelCount * 2)), maxCommittedModelMessages: Math.max(5, Math.min(6, modelCount * 2)), maxRepliesPerActor: 2, maxWallClockMs: 60_000 };
}
