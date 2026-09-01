import { describe, expect, it } from 'vitest';
import { getSocialPacingBudget } from '../../../src/social/runtime/social-pacing.js';

describe('social pacing profiles', () => {
  it('should provide bounded quiet, balanced, and lively budgets', () => {
    const quiet = getSocialPacingBudget('quiet', 3);
    const balanced = getSocialPacingBudget('balanced', 3);
    const lively = getSocialPacingBudget('lively', 3);
    expect(quiet.maxRepliesPerActor).toBe(1);
    expect(balanced.maxRepliesPerActor).toBe(2);
    expect(lively.maxRepliesPerActor).toBe(3);
    expect(quiet.maxModelRuns).toBeLessThan(balanced.maxModelRuns);
    expect(balanced.maxModelRuns).toBeLessThan(lively.maxModelRuns);
    expect(quiet.maxWallClockMs).toBeLessThan(balanced.maxWallClockMs);
    expect(balanced.maxWallClockMs).toBeLessThan(lively.maxWallClockMs);
  });
});
