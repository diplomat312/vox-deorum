import { describe, expect, it } from 'vitest';
import { benchmarkConditionModelSets } from '../../../scripts/social-live-benchmark.js';

describe('social benchmark condition policy', () => {
  it('isolates each screen candidate into a same-model condition', () => {
    const conditions = benchmarkConditionModelSets('protocol', ['provider/model-a', 'provider/model-b', 'provider/model-c', 'provider/model-d']);
    expect(conditions).toEqual([
      ['provider/model-a', 'provider/model-a', 'provider/model-a'],
      ['provider/model-b', 'provider/model-b', 'provider/model-b'],
      ['provider/model-c', 'provider/model-c', 'provider/model-c'],
      ['provider/model-d', 'provider/model-d', 'provider/model-d'],
    ]);
  });

  it('isolates political candidates across four distinct actor profiles', () => {
    const conditions = benchmarkConditionModelSets('political', ['provider/model-a', 'provider/model-b', 'provider/model-c', 'provider/model-d']);
    expect(conditions).toHaveLength(4);
    for (const [index, condition] of conditions.entries()) expect(condition).toEqual(Array.from({ length: 4 }, () => `provider/model-${String.fromCharCode(97 + index)}`));
  });

  it('retains mixed-model sessions only when explicitly requested', () => {
    expect(benchmarkConditionModelSets('protocol', ['provider/model-a', 'provider/model-b'], { mixedModels: true })).toEqual([['provider/model-a', 'provider/model-b', 'provider/model-a']]);
  });
});
