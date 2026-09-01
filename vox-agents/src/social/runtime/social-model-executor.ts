import type { ModelMessage } from 'ai';
import { getModel, getStrictModelConfig } from '../../utils/models/models.js';
import { streamTextWithConcurrency, withModelConfig } from '../../utils/models/concurrency.js';
import { createLogger } from '../../utils/logger.js';
import { createSocialDecisionTools, decodeSocialDecision, type SocialDecisionToolScope } from './social-decision-tools.js';
import type { SocialActor, SocialDecision } from '../types.js';
import type { SocialContextBundle } from '../context/social-context-builder.js';
import { socialDecisionOutputTokenLimit } from './social-pacing.js';

/** Provider-neutral model decision generator. It never applies the returned action. */
export interface SocialModelExecutor { decide(actor: SocialActor, context: SocialContextBundle, actorNames: string[], abortSignal?: AbortSignal): Promise<SocialDecision>; }
export interface SocialDecisionUsage { inputTokens?: number; outputTokens?: number; totalTokens?: number; cachedTokens?: number; reasoningTokens?: number; cost?: number; }
export interface SocialDecisionRun { decision: SocialDecision; retryCount: number; semanticRetryCount?: number; providerAttemptCount?: number; providerRetryCount?: number; providerFailureClass?: string; providerHttpStatus?: number; providerErrorType?: string; providerErrorCode?: string; providerErrorSummary?: string; latencyMs: number; usage?: SocialDecisionUsage; }
export interface InstrumentedSocialModelExecutor extends SocialModelExecutor { decideWithTelemetry(actor: SocialActor, context: SocialContextBundle, actorNames: string[], abortSignal?: AbortSignal): Promise<SocialDecisionRun>; }

/** Carry sanitized decision telemetry through a terminal provider or protocol failure. */
export interface SocialDecisionFailureTelemetry { retryCount: number; semanticRetryCount: number; providerAttemptCount: number; providerRetryCount: number; providerFailureClass?: string; providerHttpStatus?: number; providerErrorType?: string; providerErrorCode?: string; providerErrorSummary?: string; latencyMs: number; }

/** Preserve logical decision metadata without retaining provider response bodies or reasoning. */
export class SocialDecisionExecutionError extends Error {
  public constructor(message: string, public readonly telemetry: SocialDecisionFailureTelemetry, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SocialDecisionExecutionError';
  }
}

/** Backward-compatible type name for callers that supplied the old model executor interface. */
export type SocialDecisionExecutor = SocialModelExecutor;

/** Generate exactly one validated, side-effect-free decision tool call. */
export class SocialModelExecutorImpl implements InstrumentedSocialModelExecutor {
  private readonly logger = createLogger('social-model-executor');

  /** Execute one actor decision with one constrained retry for invalid structured output. */
  public async decide(actor: SocialActor, context: SocialContextBundle, actorNames: string[], abortSignal?: AbortSignal): Promise<SocialDecision> {
    return (await this.decideWithTelemetry(actor, context, actorNames, abortSignal)).decision;
  }

  /** Generate one semantic decision and expose only coarse timing and retry metadata. */
  public async decideWithTelemetry(actor: SocialActor, context: SocialContextBundle, _actorNames: string[], abortSignal?: AbortSignal): Promise<SocialDecisionRun> {
    const startedAt = Date.now();
    const modelConfig = getStrictModelConfig(actor.modelRef ?? 'default');
    const extra = context.decisionToolDefinitions ?? [];
    const tools = context.decisionTools ?? createSocialDecisionTools((context.executionScope ?? 'player-mind') as SocialDecisionToolScope, context.references, extra);
    let messages = context.messages as ModelMessage[];
    let lastError: unknown;
    let providerAttemptCount = 0;
    let providerFailureClass: string | undefined;
    let providerFailureDetails: ProviderFailureDetails | undefined;
    let semanticRetryCount = 0;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await streamTextWithConcurrency(withModelConfig({
          model: getModel(modelConfig),
          system: context.system,
          messages,
          tools,
          activeTools: Object.keys(tools),
          toolChoice: 'required',
          maxOutputTokens: socialDecisionOutputTokenLimit,
          stopWhen: () => true,
          maxRetries: 0,
          abortSignal,
        }, modelConfig), { logger: this.logger, timeoutRefresh: undefined, onProviderAttempt: () => { providerAttemptCount += 1; }, onProviderError: (error) => { const details = extractProviderFailureDetails(error); providerFailureClass ??= classifyProviderFailure(error, details); providerFailureDetails = mergeProviderFailureDetails(providerFailureDetails, details); } }, { maxRetries: 2, initialDelayMs: 1000, maxDelayMs: 5000, backoffFactor: 2 });
        const steps = (result as unknown as { steps?: Array<{ toolCalls?: readonly unknown[] }> }).steps ?? [];
        const calls = steps.flatMap((step) => step.toolCalls ?? []);
        const usage = await readUsage(result);
        return { decision: decodeSocialDecision(calls, extra), retryCount: semanticRetryCount, semanticRetryCount, providerAttemptCount, providerRetryCount: Math.max(0, providerAttemptCount - (semanticRetryCount + 1)), ...(providerFailureClass ? { providerFailureClass } : {}), ...providerFailureDetails, latencyMs: Date.now() - startedAt, ...(usage ? { usage } : {}) };
      } catch (error) {
        lastError = error;
        const details = extractProviderFailureDetails(error);
        providerFailureDetails = mergeProviderFailureDetails(providerFailureDetails, details);
        providerFailureClass ??= classifyProviderFailure(error, details);
        if (abortSignal?.aborted || !(error instanceof Error && error.message.startsWith('invalid-output:')) || attempt === 1) break;
        semanticRetryCount += 1;
        messages = [...messages, { role: 'user', content: 'Your previous response was not a valid decision tool call. Choose exactly one available decision tool, with schema-valid arguments. Do not write prose.' }];
      }
    }
    throw new SocialDecisionExecutionError(
      providerFailureDetails?.providerErrorSummary ?? safeErrorMessage(lastError),
      {
        retryCount: semanticRetryCount,
        semanticRetryCount,
        providerAttemptCount,
        providerRetryCount: Math.max(0, providerAttemptCount - (semanticRetryCount + 1)),
        ...(providerFailureClass ? { providerFailureClass } : {}),
        ...providerFailureDetails,
        latencyMs: Date.now() - startedAt,
      },
      { cause: lastError },
    );
  }
}

/** Reduce provider errors to a safe diagnostic category without retaining response bodies. */
function classifyProviderFailure(error: unknown, details: ProviderFailureDetails = extractProviderFailureDetails(error)): string {
  const message = error instanceof Error ? error.message : String(error);
  if (details.providerHttpStatus === 429 || /429|rate.?limit|usage.?limit/i.test(message) || /rate.?limit|usage.?limit/i.test(details.providerErrorCode ?? '')) return 'rate-limit';
  if (/timeout|timed out/i.test(message)) return 'timeout';
  if (/network|fetch|connect|socket/i.test(message)) return 'network';
  return 'provider';
}

interface ProviderFailureDetails {
  providerHttpStatus?: number;
  providerErrorType?: string;
  providerErrorCode?: string;
  providerErrorSummary?: string;
}

/** Extract a safe, bounded provider error shape without retaining response bodies or credentials. */
export function extractProviderFailureDetails(error: unknown): ProviderFailureDetails {
  const records = collectErrorRecords(error);
  const status = records.map((record) => readNumber(record, 'statusCode') ?? readNumber(record, 'status')).find((value) => value !== undefined);
  const providerError = records.map((record) => asRecord(record.error)).find((value) => value !== undefined);
  const candidates = providerError ? [providerError, ...records] : records;
  const type = candidates.map((record) => readString(record, 'type')).find(Boolean);
  const code = candidates.map((record) => readString(record, 'code')).find(Boolean);
  const message = candidates.map((record) => readString(record, 'message')).find(Boolean);
  const summary = message ? sanitizeProviderSummary(message) : status === undefined ? undefined : defaultProviderSummary(status);
  return {
    ...(status === undefined ? {} : { providerHttpStatus: status }),
    ...(type ? { providerErrorType: sanitizeValue(type) } : {}),
    ...(code ? { providerErrorCode: sanitizeValue(code) } : {}),
    ...(summary ? { providerErrorSummary: summary } : {}),
  };
}

/** Merge later provider details without discarding a useful status or message already captured. */
function mergeProviderFailureDetails(current: ProviderFailureDetails | undefined, next: ProviderFailureDetails): ProviderFailureDetails | undefined {
  if (!current) return Object.keys(next).length ? next : undefined;
  return { ...next, ...current, providerErrorSummary: current.providerErrorSummary ?? next.providerErrorSummary };
}

/** Convert a provider exception into a safe terminal message for the persisted diagnostic. */
function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) return sanitizeProviderSummary(error.message) ?? 'social decision failed';
  return sanitizeProviderSummary(String(error)) ?? 'social decision failed';
}

/** Collect shallow error records and parsed provider response errors for common AI SDK shapes. */
function collectErrorRecords(error: unknown): Array<Record<string, unknown>> {
  const records: Array<Record<string, unknown>> = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    const record = asRecord(current);
    if (!record) break;
    records.push(record);
    const responseBody = parseJsonRecord(record.responseBody);
    if (responseBody) records.push(responseBody, ...(asRecord(responseBody.error) ? [asRecord(responseBody.error)!] : []));
    current = record.cause;
  }
  return records;
}

/** Narrow unknown values to object records. */
function asRecord(value: unknown): Record<string, unknown> | undefined { return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined; }
/** Read a finite numeric field from an error record. */
function readNumber(record: Record<string, unknown>, key: string): number | undefined { const value = record[key]; return typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : undefined; }
/** Read a nonempty string field from an error record. */
function readString(record: Record<string, unknown>, key: string): string | undefined { const value = record[key]; return typeof value === 'string' && value.trim() ? value : undefined; }
/** Parse only JSON object response bodies, never retaining the raw body. */
function parseJsonRecord(value: unknown): Record<string, unknown> | undefined { if (typeof value !== 'string') return asRecord(value); try { return asRecord(JSON.parse(value)); } catch { return undefined; } }
/** Redact common credential-shaped values and cap provider text for diagnostics. */
function sanitizeProviderSummary(value: string): string | undefined { const sanitized = value.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/(api[_-]?key|token|secret)\s*[:=]\s*\S+/gi, '$1 [redacted]').trim().slice(0, 500); return sanitized || undefined; }
/** Keep provider codes and types bounded and free of control characters. */
function sanitizeValue(value: string): string { return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120); }
/** Provide a safe fallback when the provider omitted a human-readable message. */
function defaultProviderSummary(status: number): string { if (status === 400) return 'provider rejected the request'; if (status === 401) return 'provider authorization failed'; if (status === 403) return 'provider access forbidden'; if (status === 404) return 'model or endpoint unavailable'; if (status === 429) return 'provider rate limit or usage limit exceeded'; if (status >= 500) return 'provider server error'; return `provider request failed with HTTP ${status}`; }

/** Default model executor instance used by the social scheduler. */
export const defaultSocialModelExecutor = new SocialModelExecutorImpl();

/** Read provider usage without requiring every provider to expose every field. */
async function readUsage(result: unknown): Promise<SocialDecisionUsage | undefined> {
  const candidate = result as { usage?: Promise<Record<string, unknown>> | Record<string, unknown> };
  const raw = candidate.usage ? await candidate.usage : undefined;
  if (!raw) return undefined;
  const usage: SocialDecisionUsage = {};
  for (const [source, target] of [['inputTokens', 'inputTokens'], ['outputTokens', 'outputTokens'], ['totalTokens', 'totalTokens'], ['cachedInputTokens', 'cachedTokens'], ['reasoningTokens', 'reasoningTokens'], ['cost', 'cost']] as const) {
    const value = raw[source];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) usage[target] = value;
  }
  return Object.keys(usage).length ? usage : undefined;
}
