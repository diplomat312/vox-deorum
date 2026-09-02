import { describe, expect, it } from 'vitest';
import { ActorLane } from '../../../src/social/runtime/actor-lane.js';

describe('ActorLane', () => {
  it('should never overlap authoritative runs for one actor and should recover after failure', async () => {
    const lane = new ActorLane();
    let active = 0;
    let maximum = 0;
    const run = (value: string, fail = false): Promise<string> => lane.run(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      if (fail) throw new Error('failed run');
      return value;
    });
    const first = run('first');
    const second = run('second');
    expect(await first).toBe('first');
    expect(await second).toBe('second');
    await expect(run('failure', true)).rejects.toThrow('failed run');
    expect(await run('recovered')).toBe('recovered');
    expect(maximum).toBe(1);
  });

  it('should allow nested admission for support and deal work', async () => {
    const lane = new ActorLane();
    const result = await lane.run(async () => lane.run(async () => 'nested'));
    expect(result).toBe('nested');
  });
});
