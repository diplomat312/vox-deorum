import type { ModelMessage } from 'ai';
import { getModel, getModelConfig } from '../../utils/models/models.js';
import { streamTextWithConcurrency, withModelConfig } from '../../utils/models/concurrency.js';
import { createLogger } from '../../utils/logger.js';
import { normalizeSocialOutput } from './social-output.js';
import type { SocialActor } from '../types.js';
import type { SocialContextBundle } from '../context/social-context-builder.js';

export type SocialDecision = { outcome: 'speak'; content: string } | { outcome: 'pass' };
export interface SocialDecisionExecutor { decide(actor: SocialActor, context: SocialContextBundle, actorNames: string[], abortSignal?: AbortSignal): Promise<SocialDecision>; }

/** Provider-neutral social model execution through the shared Vox concurrency/retry layer. */
export class SocialModelExecutor implements SocialDecisionExecutor {
  private readonly logger = createLogger('social-model-executor');

  /** Execute one actor decision with a bounded social retry policy. */
  public async decide(actor: SocialActor, context: SocialContextBundle, actorNames: string[], abortSignal?: AbortSignal): Promise<SocialDecision> {
    const modelConfig = getModelConfig(actor.modelRef ?? 'default');
    const result = await streamTextWithConcurrency(withModelConfig({ model: getModel(modelConfig), system: context.system, messages: context.messages as ModelMessage[], abortSignal }, modelConfig), { logger: this.logger, timeoutRefresh: undefined }, { maxRetries: 2, initialDelayMs: 1000, maxDelayMs: 5000, backoffFactor: 2 });
    const text = await (result as unknown as { text: Promise<string> }).text;
    const content = normalizeSocialOutput(text, actorNames);
    return content ? { outcome: 'speak', content } : { outcome: 'pass' };
  }
}
