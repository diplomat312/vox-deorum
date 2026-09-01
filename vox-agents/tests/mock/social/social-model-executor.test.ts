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
    providerSuccess(result());
    const run = await new SocialModelExecutorImpl().decideWithTelemetry(actor, context, []);
    expect(run.providerAttemptCount).toBe(1);
    expect(run.providerRetryCount).toBe(0);
    expect(run.semanticRetryCount).toBe(0);
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

  it('classifies a provider usage limit from structured error fields', () => {
    expect(extractProviderFailureDetails({ statusCode: 429, responseBody: JSON.stringify({ error: { type: 'FreeUsageLimitError', code: 'rate_limit_exceeded', message: 'Please try again later.' } }) })).toEqual({
      providerHttpStatus: 429,
      providerErrorType: 'FreeUsageLimitError',
      providerErrorCode: 'rate_limit_exceeded',
      providerErrorSummary: 'Please try again later.',
    });
  });
});
