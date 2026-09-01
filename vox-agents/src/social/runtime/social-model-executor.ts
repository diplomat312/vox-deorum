import type { ModelMessage } from 'ai';
import { getModel, getModelConfig } from '../../utils/models/models.js';
import { streamTextWithConcurrency, withModelConfig } from '../../utils/models/concurrency.js';
import { createLogger } from '../../utils/logger.js';
import { createSocialDecisionTools, decodeSocialDecision, type SocialDecisionToolScope } from './social-decision-tools.js';
import type { SocialActor, SocialDecision } from '../types.js';
import type { SocialContextBundle } from '../context/social-context-builder.js';

/** Provider-neutral model decision generator. It never applies the returned action. */
export interface SocialModelExecutor { decide(actor: SocialActor, context: SocialContextBundle, actorNames: string[], abortSignal?: AbortSignal): Promise<SocialDecision>; }
export interface SocialDecisionUsage { inputTokens?: number; outputTokens?: number; totalTokens?: number; cachedTokens?: number; reasoningTokens?: number; cost?: number; }
export interface SocialDecisionRun { decision: SocialDecision; retryCount: number; latencyMs: number; usage?: SocialDecisionUsage; }
export interface InstrumentedSocialModelExecutor extends SocialModelExecutor { decideWithTelemetry(actor: SocialActor, context: SocialContextBundle, actorNames: string[], abortSignal?: AbortSignal): Promise<SocialDecisionRun>; }

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
    const modelConfig = getModelConfig(actor.modelRef ?? 'default');
    const extra = context.decisionToolDefinitions ?? [];
    const tools = context.decisionTools ?? createSocialDecisionTools((context.executionScope ?? 'player-mind') as SocialDecisionToolScope, context.references, extra);
    let messages = context.messages as ModelMessage[];
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await streamTextWithConcurrency(withModelConfig({
          model: getModel(modelConfig),
          system: context.system,
          messages,
          tools,
          activeTools: Object.keys(tools),
          toolChoice: 'required',
          stopWhen: () => true,
          maxRetries: 0,
          abortSignal,
        }, modelConfig), { logger: this.logger, timeoutRefresh: undefined }, { maxRetries: 2, initialDelayMs: 1000, maxDelayMs: 5000, backoffFactor: 2 });
        const steps = (result as unknown as { steps?: Array<{ toolCalls?: readonly unknown[] }> }).steps ?? [];
        const calls = steps.flatMap((step) => step.toolCalls ?? []);
        const usage = await readUsage(result);
        return { decision: decodeSocialDecision(calls, extra), retryCount: attempt, latencyMs: Date.now() - startedAt, ...(usage ? { usage } : {}) };
      } catch (error) {
        lastError = error;
        if (abortSignal?.aborted || !(error instanceof Error && error.message.startsWith('invalid-output:')) || attempt === 1) break;
        messages = [...messages, { role: 'user', content: 'Your previous response was not a valid decision tool call. Choose exactly one available decision tool, with schema-valid arguments. Do not write prose.' }];
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`invalid-output: ${String(lastError)}`);
  }
}

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
