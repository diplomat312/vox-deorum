import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SocialActor } from '../../../src/social/types.js';
import type { SocialContextBundle } from '../../../src/social/context/social-context-builder.js';

const mocks = vi.hoisted(() => ({
  stream: vi.fn(),
  getModel: vi.fn(() => ({})),
  getStrictModelConfig: vi.fn(() => ({ provider: 'openrouter', name: 'test-model' })),
}));

vi.mock('../../../src/utils/models/concurrency.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../src/utils/models/concurrency.js')>(),
  streamTextWithConcurrency: mocks.stream,
}));
vi.mock('../../../src/utils/models/models.js', () => ({ getModel: mocks.getModel, getStrictModelConfig: mocks.getStrictModelConfig }));

import { extractProviderFailureDetails, SocialDecisionExecutionError, SocialModelExecutorImpl } from '../../../src/social/runtime/social-model-executor.js';

const actor: SocialActor = { id: 'alice', ordinal: 1, control: 'model', displayName: 'Alice', modelRef: 'openrouter/test-model', sessionId: 'executor', createdAt: new Date().toISOString(), status: 'active' };
const context: SocialContextBundle = { system: 'Choose one action.', messages: [], references: { actors: [], channels: [], dmActors: [], groupParticipants: [], messageRooms: [], inviteRooms: [], inviteParticipants: [], inviteTargets: [], leaveRooms: [] }, executionScope: 'player-mind' };

/** Return a provider result containing exactly one semantic decision call. */
function result(toolName = 'social_pass'): object { return { steps: [{ toolCalls: [{ toolName, input: { reason: 'quiet' } }] }] }; }

/** Simulate the callback sequence emitted by the shared provider retry wrapper. */
function providerSuccess(value: object, failures = 0, failureMessage = 'network failure'): void { mocks.stream.mockImplementationOnce(async (_params: unknown, callContext: { onProviderAttempt?: (attempt: number) => void; onProviderError?: (error: unknown) => void }) => { for (let attempt = 0; attempt <= failures; attempt += 1) { callContext.onProviderAttempt?.(attempt); if (attempt < failures) callContext.onProviderError?.(new Error(failureMessage)); } return value; }); }

beforeEach(() => mocks.stream.mockReset());

describe('SocialModelExecutorImpl provider telemetry', () => {
  it('records one provider attempt for a first-attempt success', async () => {
    mocks.stream.mockImplementationOnce(async (params: { maxOutputTokens?: number }, callContext: { onProviderAttempt?: (attempt: number) => void }) => { expect(params.maxOutputTokens).toBe(8192); callContext.onProviderAttempt?.(0); return result(); });
    const run = await new SocialModelExecutorImpl().decideWithTelemetry(actor, context, []);
    expect(run.providerAttemptCount).toBe(1);
    expect(run.providerRetryCount).toBe(0);
    expect(run.semanticRetryCount).toBe(0);
  });

  it('passes the active social decisions as exactly-one terminal tools', async () => {
    providerSuccess(result());
    const decisionTools = { social_pass: {} as any, social_reply: {} as any };
    await new SocialModelExecutorImpl().decideWithTelemetry(actor, { ...context, decisionTools }, []);
    expect(mocks.getModel).toHaveBeenCalledWith(
      { provider: 'openrouter', name: 'test-model' },
      { completionTools: ['social_pass', 'social_reply'], completionCardinality: 'exactly-one' },
    );
  });

  it('keeps one transport retry separate from semantic retries', async () => {
    providerSuccess(result(), 1);
    const run = await new SocialModelExecutorImpl().decideWithTelemetry(actor, context, []);
    expect(run.providerAttemptCount).toBe(2);
    expect(run.providerRetryCount).toBe(1);
    expect(run.semanticRetryCount).toBe(0);
  });

  it('records a semantic-output retry without counting it as a provider retry', async () => {
    providerSuccess({ steps: [] });
    providerSuccess(result());
    const run = await new SocialModelExecutorImpl().decideWithTelemetry(actor, context, []);
    expect(run.providerAttemptCount).toBe(2);
    expect(run.providerRetryCount).toBe(0);
    expect(run.semanticRetryCount).toBe(1);
    expect(run.providerFailureClass).toBeUndefined();
  });

  it('rejects multiple terminal decisions instead of selecting one', async () => {
    const invalid = { steps: [{ toolCalls: [{ toolName: 'social_pass', input: { reason: 'one' } }, { toolName: 'social_pass', input: { reason: 'two' } }] }] };
    providerSuccess(invalid);
    providerSuccess(invalid);
    await expect(new SocialModelExecutorImpl().decideWithTelemetry(actor, context, [])).rejects.toMatchObject({ name: 'SocialDecisionExecutionError', telemetry: { semanticRetryCount: 1, providerAttemptCount: 2 } });
  });

  it('preserves terminal provider telemetry after multiple attempts', async () => {
    mocks.stream.mockImplementationOnce(async (_params: unknown, callContext: { onProviderAttempt?: (attempt: number) => void; onProviderError?: (error: unknown) => void }) => {
      for (let attempt = 0; attempt < 3; attempt += 1) { callContext.onProviderAttempt?.(attempt); callContext.onProviderError?.(new Error('429 rate limit')); }
      throw new Error('429 rate limit');
    });
    await expect(new SocialModelExecutorImpl().decideWithTelemetry(actor, context, [])).rejects.toMatchObject({
      name: 'SocialDecisionExecutionError',
      telemetry: { providerAttemptCount: 3, providerRetryCount: 2, semanticRetryCount: 0, providerFailureClass: 'rate-limit' },
    } as Partial<SocialDecisionExecutionError>);
  });

  it('preserves sanitized provider status, type, code, and summary on terminal failure', async () => {
    const error = Object.assign(new Error('provider request failed'), {
      statusCode: 400,
      responseBody: JSON.stringify({ error: { type: 'invalid_request_error', code: 'unsupported_parameter', message: 'tool_choice must be auto; Bearer secret-value' } }),
    });
    mocks.stream.mockImplementationOnce(async (_params: unknown, callContext: { onProviderAttempt?: (attempt: number) => void; onProviderError?: (error: unknown) => void }) => {
      for (let attempt = 0; attempt < 3; attempt += 1) { callContext.onProviderAttempt?.(attempt); callContext.onProviderError?.(error); }
      throw error;
    });
    await expect(new SocialModelExecutorImpl().decideWithTelemetry(actor, context, [])).rejects.toMatchObject({
      telemetry: {
        providerAttemptCount: 3,
        providerRetryCount: 2,
        providerFailureClass: 'provider',
        providerHttpStatus: 400,
        providerErrorType: 'invalid_request_error',
        providerErrorCode: 'unsupported_parameter',
        providerErrorSummary: 'tool_choice must be auto; Bearer [redacted]',
      },
    });
  });

  it('captures safe Responses-style output metadata without retaining content', async () => {
    providerSuccess({
      steps: [{
        toolCalls: [{ toolName: 'social_pass', input: { reason: 'quiet' } }],
        content: [{ type: 'reasoning', text: 'private reasoning' }, { type: 'tool-call', toolName: 'social_pass' }],
        text: '',
        finishReason: 'tool-calls',
        rawFinishReason: 'function_call',
        response: { body: { output: [{ type: 'reasoning', summary: 'private reasoning' }, { type: 'function_call', name: 'social_pass' }] } },
      }],
    });
    const run = await new SocialModelExecutorImpl().decideWithTelemetry(actor, context, []);
    expect(run.diagnostics).toEqual({
      outputTokenLimit: 8192,
      finishReason: 'tool-calls',
      rawFinishReason: 'function_call',
      responseOutputItemCount: 2,
      responseOutputItemTypesJson: '["reasoning","function_call"]',
      responseOutputItemSource: 'provider-body',
      sdkToolCallCount: 1,
      sdkTextLength: 0,
      responseFunctionCallDetected: true,
      outputLimitReached: false,
    });
  });

  it('preserves zero-tool structural diagnostics after semantic retries are exhausted', async () => {
    const noDecision = {
      steps: [{
        toolCalls: [],
        content: [{ type: 'reasoning', text: 'private reasoning' }, { type: 'text', text: 'ordinary prose' }],
        text: 'ordinary prose',
        finishReason: 'length',
        rawFinishReason: 'max_output_tokens',
        response: { body: { incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'reasoning' }, { type: 'message' }] } },
      }],
    };
    providerSuccess(noDecision);
    providerSuccess(noDecision);
    await expect(new SocialModelExecutorImpl().decideWithTelemetry(actor, context, [])).rejects.toMatchObject({
      telemetry: {
        semanticRetryCount: 1,
        diagnostics: {
          outputTokenLimit: 8192,
          finishReason: 'length',
          rawFinishReason: 'max_output_tokens',
          incompleteReason: 'max_output_tokens',
          responseOutputItemCount: 2,
          responseOutputItemTypesJson: '["reasoning","message"]',
          responseOutputItemSource: 'provider-body',
          sdkToolCallCount: 0,
          sdkTextLength: 14,
          responseFunctionCallDetected: false,
          outputLimitReached: true,
        },
      },
    });
  });

  it('classifies a provider usage limit from structured error fields', () => {
    expect(extractProviderFailureDetails({ statusCode: 429, responseBody: JSON.stringify({ error: { type: 'FreeUsageLimitError', code: 'rate_limit_exceeded', message: 'Please try again later.' } }) })).toEqual({
      providerHttpStatus: 429,
      providerErrorType: 'FreeUsageLimitError',
      providerErrorCode: 'rate_limit_exceeded',
      providerErrorSummary: 'Please try again later.',
    });
  });
});
