import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { Model } from '../../../types/index.js';

/** OpenCode model families that use the Responses API. */
const responseModels = new Set(['muse-spark-1.2-contributor-free', 'muse-spark-1.2-contributor', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);

/** Model names called out by the current Zen and Go catalogues. */
export const openCodeModelNames: Record<string, readonly string[]> = {
  opencode: ['mimo-v2.5-free', 'muse-spark-1.2-contributor-free', 'ling-3.0-flash-fin-free', 'nemotron-3-ultra-free', 'nemotron-3.5-lightning-free'],
  'opencode-go': ['longcat-2.0', 'deepseek-v4-flash', 'mimo-v2.5', 'muse-spark-1.2-contributor'],
};

/** Return the transport family required by an OpenCode model. */
export function getOpenCodeTransport(provider: string, modelName: string): 'chat-completions' | 'responses' {
  if (provider !== 'opencode' && provider !== 'opencode-go') throw new Error(`Unsupported OpenCode provider '${provider}'.`);
  return responseModels.has(modelName) ? 'responses' : 'chat-completions';
}

/** Build an OpenCode Zen or Go model with the endpoint matching its model family. */
export function buildOpenCodeModel(config: Model): LanguageModelV3 {
  const baseURL = config.provider === 'opencode'
    ? 'https://opencode.ai/zen/v1'
    : 'https://opencode.ai/zen/go/v1';
  const apiKey = process.env.OPENCODE_API_KEY;
  if (getOpenCodeTransport(config.provider, config.name) === 'responses') return createOpenAI({ baseURL, name: config.provider, apiKey }).responses(config.name);
  return createOpenAICompatible({ baseURL, name: config.provider, apiKey }).chatModel(config.name);
}
