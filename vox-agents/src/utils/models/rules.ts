/**
 * @module utils/models/rules
 *
 * Model-name rules used for discovered model defaults and missing known-model
 * configuration synthesis.
 */

import type { LLMConfig } from '../../types/index.js';
import { isSynthesizableModelId } from '../../types/constants.js';

/** A case-insensitive provider and native-name rule that contributes model options. */
export interface ModelRule {
  provider?: string | string[];
  match: RegExp;
  options?: LLMConfig['options'];
}

/**
 * Applies the established configuration defaults to discovered model names.
 * Later matches deliberately win through shallow option merging.
 */
export const modelRules: ModelRule[] = [
  { match: /gpt-oss/i, options: { toolMiddleware: 'prompt' } },
  { match: /kimi/i, options: { toolMiddleware: 'prompt' } },
  { match: /glm/i, options: { toolMiddleware: 'prompt' } },
  { match: /nemotron/i, options: { toolMiddleware: 'prompt' } },
  { match: /deepseek-v3/i, options: { toolMiddleware: 'prompt' } },
  { match: /gemma-4/i, options: { toolMiddleware: 'prompt' } },
  { match: /qwen/i, options: { systemPromptFirst: true, toolMiddleware: 'prompt' } },
  { match: /minimax/i, options: { toolMiddleware: 'prompt', thinkMiddleware: 'think' } },
  { provider: 'openrouter', match: /gemma-3/i, options: { toolMiddleware: 'gemma' } },
  { provider: 'claude-code', match: /.*/, options: { concurrencyLimit: 1 } },
  { provider: 'codex', match: /gpt-5\.6-sol/i, options: { concurrencyLimit: 1 } },
  { provider: 'codex', match: /gpt-5\.6-terra/i, options: { concurrencyLimit: 2 } },
  { match: /embedder/i, options: { embeddingSize: 4096 } },
];

/** Applies all matching model-name rules without translating request-time provider options. */
export function applyModelRules(provider: string, name: string): LLMConfig['options'] | undefined {
  const matches = modelRules.filter((rule) => {
    const providers = rule.provider === undefined ? undefined : Array.isArray(rule.provider) ? rule.provider : [rule.provider];
    return (providers === undefined || providers.some((candidate) => candidate === provider))
      && rule.match.test(name);
  });
  if (matches.length === 0) return undefined;
  return matches.reduce<NonNullable<LLMConfig['options']>>((options, rule) => ({ ...options, ...rule.options }), {});
}

/**
 * Synthesizes a configuration for a known provider-qualified model identifier.
 * Request-time reasoning and provider-option translation remain in models.ts.
 */
export function synthesizeModelConfig(id: string): LLMConfig | undefined {
  const separator = id.indexOf('/');
  if (separator <= 0 || separator === id.length - 1) return undefined;

  const provider = id.slice(0, separator);
  const name = id.slice(separator + 1);
  if (!isSynthesizableModelId(id)) return undefined;

  const options = applyModelRules(provider, name);
  return {
    provider,
    name,
    ...(options === undefined ? {} : { options }),
  };
}
