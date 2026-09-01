import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createAnthropic } from '@ai-sdk/anthropic';
import { wrapLanguageModel } from 'ai';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { Model } from '../../../types/index.js';
import { requiredToolChoiceMiddleware } from './required-tool-choice.js';

/** OpenCode wire transports supported by the provider adapter. */
export type OpenCodeTransport = 'chat-completions' | 'responses' | 'messages';

/** Model names that use the OpenAI Responses API. */
const responseModels = new Set([
  'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
  'gpt-5.5', 'gpt-5.5-pro', 'gpt-5.4', 'gpt-5.4-pro', 'gpt-5.4-mini', 'gpt-5.4-nano',
  'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.2', 'gpt-5.2-codex', 'gpt-5.1',
  'gpt-5.1-codex', 'gpt-5.1-codex-max', 'gpt-5.1-codex-mini', 'gpt-5', 'gpt-5-codex',
  'gpt-5-nano', 'grok-4.6', 'grok-4.5', 'grok-build-0.1', 'muse-spark-1.2',
  'muse-spark-1.2-contributor-free', 'muse-spark-1.2-contributor',
]);

/** Model names that use the Anthropic Messages API. */
const messageModels = new Set([
  'claude-fable-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6',
  'claude-opus-4-5', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5',
  'claude-haiku-4-5', 'qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-max', 'qwen3.7-plus',
  'qwen3.6-plus', 'qwen3.5-plus', 'minimax-m3', 'minimax-m2.7', 'minimax-m2.5',
]);

/** Model names currently exposed by the documented Zen and Go catalogues. */
export const openCodeModelNames: Record<string, readonly string[]> = {
  opencode: [
    'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5', 'gpt-5.5-pro', 'gpt-5.4',
    'gpt-5.4-pro', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.3-codex', 'gpt-5.3-codex-spark',
    'gpt-5.2', 'gpt-5.2-codex', 'gpt-5.1', 'gpt-5.1-codex', 'gpt-5.1-codex-max',
    'gpt-5.1-codex-mini', 'gpt-5', 'gpt-5-codex', 'gpt-5-nano', 'claude-fable-5',
    'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6', 'claude-opus-4-5',
    'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5',
    'grok-4.6', 'grok-4.5', 'grok-build-0.1', 'muse-spark-1.2', 'qwen3.7-max',
    'qwen3.7-plus', 'qwen3.6-plus', 'qwen3.5-plus', 'deepseek-v4-pro', 'deepseek-v4-flash',
    'minimax-m3', 'minimax-m2.7', 'minimax-m2.5', 'glm-5.2', 'glm-5.1', 'glm-5',
    'kimi-k2.5', 'kimi-k2.6', 'kimi-k2.7-code', 'kimi-k3', 'big-pickle',
    'mimo-v2.5-free', 'ling-3.0-flash-fin-free', 'nemotron-3-ultra-free',
    'nemotron-3.5-lightning-free', 'muse-spark-1.2-contributor-free',
  ],
  'opencode-go': [
    'grok-4.6', 'glm-5.3-flash', 'glm-5.3', 'glm-5.2', 'glm-5.1', 'gpt-5.6-luna',
    'kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6', 'longcat-2.0', 'mimo-v2.5', 'mimo-v2.5-pro',
    'minimax-m3', 'minimax-m2.7', 'minimax-m2.5', 'muse-spark-1.2-contributor',
    'qwen3.8-max', 'qwen3.8-flash', 'qwen3.7-max', 'qwen3.7-plus', 'qwen3.6-plus',
    'deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'hy4-preview', 'hy3',
  ],
};

/** Return the transport family required by an OpenCode model. */
export function getOpenCodeTransport(provider: string, modelName: string): OpenCodeTransport {
  if (provider !== 'opencode' && provider !== 'opencode-go') throw new Error(`Unsupported OpenCode provider '${provider}'.`);
  if (messageModels.has(modelName)) return 'messages';
  return responseModels.has(modelName) ? 'responses' : 'chat-completions';
}

/** Return whether the model's wire endpoint rejects a required tool choice. */
export function getOpenCodeToolChoiceCapability(provider: string, modelName: string): 'required' | 'auto-only' {
  const transport = getOpenCodeTransport(provider, modelName);
  return transport === 'messages' || (transport === 'responses' && modelName.includes('muse-spark-1.2-contributor')) ? 'auto-only' : 'required';
}

/** Resolve the current OpenCode key while accepting the legacy Zen-specific environment name. */
export function getOpenCodeApiKey(): string | undefined { return process.env.OPENCODE_API_KEY || process.env.OPENCODE_ZEN_API_KEY; }

/** Build an OpenCode Zen or Go model with the documented endpoint and tool policy. */
export function buildOpenCodeModel(config: Model, options: { completionTools?: string[] } = {}): LanguageModelV3 {
  const baseURL = config.provider === 'opencode'
    ? 'https://opencode.ai/zen/v1'
    : 'https://opencode.ai/zen/go/v1';
  const apiKey = getOpenCodeApiKey();
  const transport = getOpenCodeTransport(config.provider, config.name);
  const model = transport === 'responses'
    ? createOpenAI({ baseURL, name: config.provider, apiKey }).responses(config.name)
    : transport === 'messages'
      ? createAnthropic({ baseURL, name: config.provider, authToken: apiKey })(config.name)
      : createOpenAICompatible({ baseURL, name: config.provider, apiKey }).chatModel(config.name);
  if (getOpenCodeToolChoiceCapability(config.provider, config.name) !== 'auto-only') return model;
  const relaxStrictSchemas = config.name === 'muse-spark-1.2-contributor-free' || config.name === 'muse-spark-1.2-contributor';
  return wrapLanguageModel({ model, middleware: requiredToolChoiceMiddleware({ completionTools: options.completionTools, relaxStrictSchemas }) });
}
