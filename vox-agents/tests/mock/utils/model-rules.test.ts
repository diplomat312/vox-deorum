/** Tests for model-name rules and missing known-provider configuration synthesis. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  config: {
    llms: {
      default: { provider: 'openai', name: 'configured-default' },
      'openai/gpt-oss-registered': { provider: 'openai', name: 'explicit-name' },
    },
  },
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../src/utils/config.js', () => ({ config: mocks.config }));
vi.mock('../../../src/utils/logger.js', () => ({ createLogger: vi.fn(() => mocks.logger) }));

import { getModelConfig } from '../../../src/utils/models/models.js';
import { applyModelRules, modelRules, synthesizeModelConfig } from '../../../src/utils/models/rules.js';
import { isSynthesizableModelId } from '../../../src/types/constants.js';

describe('model rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config.llms = {
      default: { provider: 'openai', name: 'configured-default' },
      'openai/gpt-oss-registered': { provider: 'openai', name: 'explicit-name' },
    };
  });

  it('should merge overlapping rules case-insensitively', () => {
    expect(applyModelRules('openrouter', 'Google/Gemma-3-27B')).toEqual({
      toolMiddleware: 'gemma',
    });
    expect(applyModelRules('openai-compatible', 'MiniMax-Embedder')).toEqual({
      toolMiddleware: 'prompt',
      thinkMiddleware: 'think',
      embeddingSize: 4096,
    });
  });

  it('should shallow-merge later rules and accept provider arrays', () => {
    const length = modelRules.length;
    modelRules.push(
      { provider: ['openai', 'google'], match: /temporary/i, options: { toolMiddleware: 'prompt', concurrencyLimit: 1 } },
      { provider: 'openai', match: /temporary/i, options: { concurrencyLimit: 2 } },
    );
    try {
      expect(applyModelRules('openai', 'temporary-model')).toEqual({ toolMiddleware: 'prompt', concurrencyLimit: 2 });
      expect(applyModelRules('google', 'temporary-model')).toEqual({ toolMiddleware: 'prompt', concurrencyLimit: 1 });
    } finally {
      modelRules.splice(length);
    }
  });

  it('should synthesize representative known provider configurations', () => {
    expect(synthesizeModelConfig('openai-compatible/Qwen-3.6')).toEqual({
      provider: 'openai-compatible',
      name: 'Qwen-3.6',
      options: { systemPromptFirst: true, toolMiddleware: 'prompt' },
    });
    expect(synthesizeModelConfig('claude-code/custom')).toMatchObject({
      provider: 'claude-code', name: 'custom', options: { concurrencyLimit: 1 },
    });
    expect(synthesizeModelConfig('codex/gpt-5.6-terra')).toMatchObject({
      provider: 'codex', name: 'gpt-5.6-terra', options: { concurrencyLimit: 2 },
    });
  });

  it('should not synthesize an agent identifier or unsupported provider', () => {
    expect(synthesizeModelConfig('strategist')).toBeUndefined();
    expect(synthesizeModelConfig('unknown/example')).toBeUndefined();
  });

  it('should share provider-qualified ID validation with configuration synthesis', () => {
    expect(isSynthesizableModelId('codex/gpt-5.6-terra')).toBe(true);
    expect(isSynthesizableModelId('codex/   ')).toBe(false);
    expect(synthesizeModelConfig('codex/   ')).toBeUndefined();
  });

  it('should preserve explicit registry precedence over matching rules', () => {
    expect(getModelConfig('openai/gpt-oss-registered')).toEqual({
      provider: 'openai', name: 'explicit-name',
    });
  });

  it('should apply reasoning to a synthesized model and log it once', () => {
    expect(getModelConfig('openai/gpt-oss-synth', 'high')).toMatchObject({
      provider: 'openai',
      name: 'gpt-oss-synth',
      options: { toolMiddleware: 'prompt', reasoningEffort: 'high' },
    });
    getModelConfig('openai/gpt-oss-synth', 'high');
    expect(mocks.logger.info).toHaveBeenCalledTimes(1);
  });

  it('should fall back from an unknown ID and warn only once', () => {
    expect(getModelConfig('missing-provider/example')).toEqual({
      provider: 'openai', name: 'configured-default',
    });
    getModelConfig('missing-provider/example');
    expect(mocks.logger.warn).toHaveBeenCalledTimes(1);
  });
});
