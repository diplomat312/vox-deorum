import { describe, expect, it } from 'vitest';
import { getOpenCodeTransport, openCodeModelNames } from '../../../src/utils/models/providers/opencode.js';

describe('OpenCode provider registry', () => {
  it('should select the documented transport for Zen and Go model families', () => {
    expect(getOpenCodeTransport('opencode', 'mimo-v2.5-free')).toBe('chat-completions');
    expect(getOpenCodeTransport('opencode', 'muse-spark-1.2-contributor-free')).toBe('responses');
    expect(getOpenCodeTransport('opencode-go', 'longcat-2.0')).toBe('chat-completions');
    expect(getOpenCodeTransport('opencode-go', 'deepseek-v4-flash')).toBe('chat-completions');
    expect(getOpenCodeTransport('opencode-go', 'mimo-v2.5')).toBe('chat-completions');
    expect(getOpenCodeTransport('opencode-go', 'muse-spark-1.2-contributor')).toBe('responses');
  });

  it('should keep the planned model catalog explicit', () => {
    expect(openCodeModelNames.opencode).toContain('mimo-v2.5-free');
    expect(openCodeModelNames['opencode-go']).toEqual(expect.arrayContaining(['longcat-2.0', 'deepseek-v4-flash', 'mimo-v2.5']));
  });
});
