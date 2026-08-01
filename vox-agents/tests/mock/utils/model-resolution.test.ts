/** Tests for discovery-verified runtime model resolution. */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class MockDiscoveryError extends Error {}
  return {
    DiscoveryError: MockDiscoveryError,
    config: { llms: { default: { provider: 'openai', name: 'default' } } as Record<string, any> },
    discoverModels: vi.fn(),
    isStaticCatalogProvider: vi.fn(() => false),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  };
});

vi.mock('../../../src/utils/config.js', () => ({ config: mocks.config }));
vi.mock('../../../src/utils/logger.js', () => ({ createLogger: vi.fn(() => mocks.logger) }));
vi.mock('../../../src/utils/models/discovery.js', () => ({
  DiscoveryError: mocks.DiscoveryError,
  discoverModels: mocks.discoverModels,
  isStaticCatalogProvider: mocks.isStaticCatalogProvider,
}));

import { agentModelReference, ensureModelsResolved, getRuntimeModel, resetRuntimeModels } from '../../../src/utils/models/resolution.js';
import { getModelConfig } from '../../../src/utils/models/models.js';

describe('ensureModelsResolved', () => {
  beforeEach(() => {
    resetRuntimeModels();
    vi.clearAllMocks();
    mocks.config.llms = { default: { provider: 'openai', name: 'default' } };
    mocks.isStaticCatalogProvider.mockReturnValue(false);
  });

  it('should register catalog hits and cache discovery by provider', async () => {
    mocks.discoverModels.mockResolvedValue([
      { id: 'openai/gpt-real', name: 'gpt-real', recommendedOptions: { reasoningEffort: 'high' } },
      { id: 'openai/gpt-other', name: 'gpt-other' },
    ]);

    await ensureModelsResolved(['openai/gpt-real', 'openai/gpt-other']);

    expect(mocks.discoverModels).toHaveBeenCalledTimes(1);
    expect(getRuntimeModel('openai/gpt-real')).toEqual({
      provider: 'openai', name: 'gpt-real', options: { reasoningEffort: 'high' },
    });
    expect(getModelConfig('openai/gpt-real')).toEqual({
      provider: 'openai', name: 'gpt-real', options: { reasoningEffort: 'high' },
    });
    expect(getRuntimeModel('openai/gpt-other')).toEqual({ provider: 'openai', name: 'gpt-other' });
  });

  it('should retain canonical catalog names for unique case-insensitive matches', async () => {
    mocks.discoverModels.mockResolvedValue([{ id: 'codex/gpt-5.6-sol', name: 'gpt-5.6-sol' }]);

    await ensureModelsResolved(['codex/GPT-5.6-Sol@high']);

    expect(getRuntimeModel('codex/GPT-5.6-Sol')).toEqual({ provider: 'codex', name: 'gpt-5.6-sol' });
    expect(getModelConfig('codex/GPT-5.6-Sol@high', 'default')).toEqual({
      provider: 'codex', name: 'gpt-5.6-sol', options: { reasoningEffort: 'high' },
    });
  });

  it('should reject a live catalog miss with a suggestion', async () => {
    mocks.discoverModels.mockResolvedValue([{ id: 'anthropic/claude-sonnet-5', name: 'claude-sonnet-5' }]);

    await expect(ensureModelsResolved(['anthropic/claude-sonet-5'])).rejects.toThrow(
      "Model 'anthropic/claude-sonet-5' is not in the anthropic provider's model list. Did you mean: anthropic/claude-sonnet-5?",
    );
  });

  it('should warn, skip registration, and retry discovery after a discovery failure', async () => {
    mocks.discoverModels
      .mockRejectedValueOnce(new mocks.DiscoveryError('offline'))
      .mockResolvedValueOnce([{ id: 'openai/gpt-real', name: 'gpt-real' }]);

    await expect(ensureModelsResolved(['openai/gpt-real'])).resolves.toBeUndefined();
    await ensureModelsResolved(['openai/gpt-real']);

    expect(mocks.logger.warn).toHaveBeenCalledTimes(1);
    expect(mocks.discoverModels).toHaveBeenCalledTimes(2);
    expect(getRuntimeModel('openai/gpt-real')).toEqual({ provider: 'openai', name: 'gpt-real' });
  });

  it('should warn rather than throw for static catalog misses', async () => {
    mocks.isStaticCatalogProvider.mockReturnValue(true);
    mocks.discoverModels.mockResolvedValue([]);

    await expect(ensureModelsResolved(['claude-code/custom'])).resolves.toBeUndefined();

    expect(getRuntimeModel('claude-code/custom')).toBeUndefined();
    expect(mocks.logger.warn).toHaveBeenCalledTimes(1);
  });

  it('should prefer the first case-insensitive hit when a catalog repeats a name', async () => {
    mocks.discoverModels.mockResolvedValue([
      { id: 'openai/GPT-Real', name: 'GPT-Real' },
      { id: 'openai/gpt-real', name: 'gpt-real' },
    ]);

    await ensureModelsResolved(['openai/gpt-Real']);

    expect(getRuntimeModel('openai/gpt-Real')).toEqual({ provider: 'openai', name: 'GPT-Real' });
  });

  it('should skip inline models, registered IDs, aliases, and alias cycles', async () => {
    mocks.config.llms = {
      default: { provider: 'openai', name: 'default' },
      registered: { provider: 'openai', name: 'registered' },
      alias: 'registered',
      first: 'second',
      second: 'first',
    };

    await ensureModelsResolved([
      { provider: 'openai', name: 'inline' },
      'registered',
      'alias',
      'first',
      'overrideAlias',
      'overrideFirst',
    ], { overrideAlias: 'registered', overrideFirst: 'overrideSecond', overrideSecond: 'overrideFirst' });

    expect(mocks.discoverModels).not.toHaveBeenCalled();
  });

  it('should reject a bare name that is not a registered alias', async () => {
    await expect(ensureModelsResolved(['gpt-5.6-terra'])).rejects.toThrow(
      "Cannot resolve model 'gpt-5.6-terra': it is not a registered llms alias and names no provider.",
    );
    expect(mocks.discoverModels).not.toHaveBeenCalled();
  });

  it('should reject a qualified reference naming an unsupported provider', async () => {
    await expect(ensureModelsResolved(['opeani/gpt-5.6-terra'])).rejects.toThrow(
      "Cannot resolve model 'opeani/gpt-5.6-terra': 'opeani' is not a supported provider.",
    );
    expect(mocks.discoverModels).not.toHaveBeenCalled();
  });

  it('should resolve an agent name to its assignment, or to default when unassigned', async () => {
    mocks.config.llms = {
      default: { provider: 'openai', name: 'default' },
      'assigned-agent': 'openai/gpt-real',
    };

    expect(agentModelReference('assigned-agent')).toBe('assigned-agent');
    expect(agentModelReference('talkative-telepathist')).toBe('default');
    expect(agentModelReference('overridden-agent', { 'overridden-agent': 'openai/gpt-real' }))
      .toBe('overridden-agent');
  });

  it('should preserve an exact explicit key before interpreting its suffix', () => {
    mocks.config.llms = {
      default: { provider: 'openai', name: 'default' },
      'openai/native@high': { provider: 'openai', name: 'literal-native-name' },
    };

    expect(getModelConfig('openai/native@high')).toEqual({ provider: 'openai', name: 'literal-native-name' });
  });
});
