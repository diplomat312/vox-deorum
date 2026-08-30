import { describe, expect, it } from 'vitest';
import { normalizeSocialOutput } from '../../../src/social/runtime/social-output.js';

describe('normalizeSocialOutput', () => {
  it('should remove think blocks and provider control tokens', () => {
    expect(normalizeSocialOutput('<think>private reasoning</think><|assistant|>Hello there.')).toBe('Hello there.');
  });

  it('should recover a clean message from a malformed tool-call fragment', () => {
    expect(normalizeSocialOutput('<|tool_call_start|>[message="Hey there! 😊"')).toBe('Hey there! 😊');
  });

  it('should suppress prompt-analysis and draft-planning text', () => {
    expect(normalizeSocialOutput('The context suggests ongoing dialogue. The assistant should respond naturally. I will craft a concise response.')).toBeUndefined();
  });

  it('should preserve normal social speech', () => {
    expect(normalizeSocialOutput('I would rather play twenty questions.')).toBe('I would rather play twenty questions.');
  });

  it('should suppress no-response and multi-speaker drafts', () => {
    expect(normalizeSocialOutput('NO_RESPONSE')).toBeUndefined();
    expect(normalizeSocialOutput('NO_RESPONSE</think> I have nothing useful to add.')).toBeUndefined();
    expect(normalizeSocialOutput('[alice] Hello. [bob] I agree.', ['Alice', 'Bob', 'Cleo'])).toBeUndefined();
    expect(normalizeSocialOutput('Alice: I will go first.', ['Alice', 'Bob', 'Cleo'])).toBeUndefined();
    expect(normalizeSocialOutput('*mulls over the clue* I have an idea.')).toBeUndefined();
  });
});
