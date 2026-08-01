/**
 * Mock-tier unit tests for src/oracle/utils/model-resolver.ts (formatModelString).
 *
 * Scope: rendering a resolved Model back into the telemetry `{provider}/{name}@{effort}`
 * string that Oracle records in trails and the results CSV. resolveModel's config lookup is
 * exercised through the replayer tests; this file covers the formatting contract and its
 * round-trip with the parser, since the recorded string is read back by resolveModel.
 */

import { describe, expect, it } from 'vitest';
import { formatModelString, resolveModel } from '../../../src/oracle/utils/model-resolver.js';
import type { Model } from '../../../src/types/index.js';
import { config } from '../../../src/utils/config.js';

function model(overrides: Partial<Model> = {}): Model {
  return { provider: 'google', name: 'gemini-3.5-flash', ...overrides };
}

describe('formatModelString', () => {
  it('appends the reasoning effort the replay ran with', () => {
    expect(formatModelString(model({ options: { reasoningEffort: 'high' } })))
      .toBe('google/gemini-3.5-flash@high');
  });

  it('omits the suffix when the model carries no reasoning effort', () => {
    // A bare provider/name must not be reported as a chosen effort.
    expect(formatModelString(model())).toBe('google/gemini-3.5-flash');
    expect(formatModelString(model({ options: {} }))).toBe('google/gemini-3.5-flash');
  });

  it('keeps unrelated model options out of the string', () => {
    expect(formatModelString(model({ options: { concurrencyLimit: 3, reasoningEffort: 'low' } })))
      .toBe('google/gemini-3.5-flash@low');
  });

  it('round-trips through resolveModel', () => {
    // The recorded string is parsed back when a trail's model is replayed again.
    const original = model({ provider: 'oracle-test', name: 'unknown-model', options: { reasoningEffort: 'medium' } });
    const resolved = resolveModel(formatModelString(original));

    expect(resolved.provider).toBe('oracle-test');
    expect(resolved.name).toBe('unknown-model');
    expect(resolved.options?.reasoningEffort).toBe('medium');
  });
});

describe('resolveModel', () => {
  it('should preserve a Codex name outside runtime preflight while applying its reasoning suffix', () => {
    expect(resolveModel('codex/GPT-5.6-Sol@high')).toEqual({
      provider: 'codex',
      name: 'GPT-5.6-Sol',
      options: { concurrencyLimit: 1, reasoningEffort: 'high' },
    });
  });

  it('should preserve a literal configured key ending in a recognized suffix', () => {
    const key = 'openai/native@high';
    config.llms[key] = { provider: 'openai', name: 'literal-native-name' };
    try {
      expect(resolveModel(key)).toEqual({ provider: 'openai', name: 'literal-native-name' });
    } finally {
      delete config.llms[key];
    }
  });
});
