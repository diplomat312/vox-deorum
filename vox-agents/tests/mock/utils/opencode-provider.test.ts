import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';

const mocks = vi.hoisted(() => ({
  responses: undefined as any,
  chat: undefined as any,
  messages: undefined as any,
}));

/** Create a recording provider model for transport and middleware assertions. */
function recordingModel() {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text: 'ok' }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      warnings: [],
    } as any),
  });
}

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: () => ({ responses: () => (mocks.responses = recordingModel()) }),
}));
vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: () => ({ chatModel: () => (mocks.chat = recordingModel()) }),
}));
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: () => () => (mocks.messages = recordingModel()),
}));

import {
  buildOpenCodeModel,
  getOpenCodeToolChoiceCapability,
  getOpenCodeTransport,
  openCodeModelNames,
} from '../../../src/utils/models/providers/opencode.js';

/** Build one valid function tool for a provider-facing call. */
function functionTool(name = 'social_pass'): any {
  return { type: 'function', name, description: 'Pass.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } };
}

/** Build the smallest call that exercises required-tool-choice middleware. */
function requiredParams(): any {
  return { prompt: [{ role: 'system', content: 'Choose one action.' }, { role: 'user', content: [{ type: 'text', text: 'Act.' }] }], tools: [functionTool()], toolChoice: { type: 'required' } };
}

describe('OpenCode provider registry', () => {
  it('should select the documented transport for Zen and Go model families', () => {
    expect(getOpenCodeTransport('opencode', 'mimo-v2.5-free')).toBe('chat-completions');
    expect(getOpenCodeTransport('opencode', 'muse-spark-1.2-contributor-free')).toBe('responses');
    expect(getOpenCodeTransport('opencode-go', 'longcat-2.0')).toBe('chat-completions');
    expect(getOpenCodeTransport('opencode-go', 'deepseek-v4-flash')).toBe('chat-completions');
    expect(getOpenCodeTransport('opencode-go', 'mimo-v2.5')).toBe('chat-completions');
    expect(getOpenCodeTransport('opencode-go', 'muse-spark-1.2-contributor')).toBe('responses');
    expect(getOpenCodeTransport('opencode-go', 'minimax-m3')).toBe('messages');
    expect(getOpenCodeTransport('opencode-go', 'minimax-m2.7')).toBe('messages');
  });

  it('reports the provider wire capability independently from semantic runtime requirements', () => {
    expect(getOpenCodeToolChoiceCapability('opencode', 'muse-spark-1.2-contributor-free')).toBe('auto-only');
    expect(getOpenCodeToolChoiceCapability('opencode-go', 'muse-spark-1.2-contributor')).toBe('auto-only');
    expect(getOpenCodeToolChoiceCapability('opencode', 'mimo-v2.5-free')).toBe('required');
    expect(getOpenCodeToolChoiceCapability('opencode-go', 'minimax-m3')).toBe('auto-only');
  });

  it('maps Muse required decisions to auto while retaining the semantic instruction', async () => {
    const model = buildOpenCodeModel({ provider: 'opencode', name: 'muse-spark-1.2-contributor-free' } as any);
    await (model as any).doGenerate(requiredParams());
    const call = mocks.responses.doGenerateCalls.at(-1);
    expect(call.toolChoice).toEqual({ type: 'auto' });
    expect(call.tools[0].strict).toBe(false);
    expect(call.prompt[0].content).toContain('tool calls');
    expect(call.prompt[0].content).toContain('social_pass');
  });

  it('applies the same Responses compatibility policy to Muse Go', async () => {
    const model = buildOpenCodeModel({ provider: 'opencode-go', name: 'muse-spark-1.2-contributor' } as any);
    await (model as any).doGenerate(requiredParams());
    const call = mocks.responses.doGenerateCalls.at(-1);
    expect(call.toolChoice).toEqual({ type: 'auto' });
    expect(call.tools[0].strict).toBe(false);
  });

  it('keeps required tool choice for a compatible OpenCode chat transport', async () => {
    const model = buildOpenCodeModel({ provider: 'opencode', name: 'mimo-v2.5-free' } as any);
    await (model as any).doGenerate(requiredParams());
    expect(mocks.chat.doGenerateCalls.at(-1).toolChoice).toEqual({ type: 'required' });
  });

  it('should keep the planned model catalog explicit', () => {
    expect(openCodeModelNames.opencode).toContain('mimo-v2.5-free');
    expect(openCodeModelNames['opencode-go']).toEqual(expect.arrayContaining(['longcat-2.0', 'deepseek-v4-flash', 'mimo-v2.5', 'minimax-m3', 'minimax-m2.7']));
  });
});
