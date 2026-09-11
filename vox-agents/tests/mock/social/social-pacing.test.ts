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

  it("should allow a table whose seats think for tens of seconds", () => {
    // A cognition layer whose turns take most of a minute cannot answer inside a
    // budget that expires while it is still thinking, and the effect of a budget
    // that is too short is that the later seats of a round are dropped and the
    // table looks quieter than it is.
    const lively = getSocialPacingBudget('lively', 4);
    const deliberate = getSocialPacingBudget('deliberate', 4);

    // Four seats thinking for up to a minute each need minutes, not 90 seconds.
    expect(deliberate.maxWallClockMs).toBeGreaterThanOrEqual(4 * 60_000);
    expect(deliberate.maxWallClockMs).toBeGreaterThan(lively.maxWallClockMs);
    // And enough runs that a round can turn into a conversation.
    expect(deliberate.maxModelRuns).toBeGreaterThan(lively.maxModelRuns);
    expect(deliberate.maxRepliesPerActor).toBeGreaterThan(lively.maxRepliesPerActor);
  });
});
