import { ActorLane } from './actor-lane.js';
import { ChannelLane } from './channel-lane.js';
import { createSocialReferenceSet, SocialContextBuilder } from '../context/social-context-builder.js';
import { defaultSocialModelExecutor, type InstrumentedSocialModelExecutor, type SocialModelExecutor } from './social-model-executor.js';
import { decisionRoutingSummary, SocialDecisionExecutor } from './social-decision-executor.js';
import { createSocialDecisionTools, type SocialDecisionToolScope } from './social-decision-tools.js';
import type { SocialActor, SocialExecutionScope, SocialIntention, SocialMessage } from '../types.js';
import { SocialStore } from '../store/social-store.js';
import { SocialEventHub } from '../events/social-event-hub.js';
import type { DecisionToolDefinition } from './social-decision-tools.js';

interface CascadePayload { rootMessageId: number; depth: number; count: number; }

/** Map every supported intention kind to an explicit execution scope. */
const executionScopes: Readonly<Record<string, SocialExecutionScope>> = {
  'consider-reply': 'channel-reaction',
  'direct-channel-follow-up': 'channel-reaction',
  'environment-event': 'player-mind',
  'strategic-review': 'player-mind',
  'native-deal-decision': 'player-mind',
  'autonomous-social': 'player-mind',
  'invitation-decision': 'player-mind',
  'memory-maintenance': 'player-mind',
};

/** Durable intention worker for autonomous social and player-mind decisions. */
export class SocialScheduler {
  private readonly channelLanes = new Map<string, ChannelLane>();
  private running = false;
  private stopped = false;
  private drainPromise: Promise<void> | undefined;
  private kickRequested = false;
  private wakeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly activeControllers = new Set<AbortController>();

  public constructor(private readonly store: SocialStore, private readonly actors: () => Promise<SocialActor[]>, private readonly lanes: Map<string, ActorLane>, private readonly events: SocialEventHub, private readonly modelExecutor: SocialModelExecutor = defaultSocialModelExecutor, private readonly contextBuilder = new SocialContextBuilder(), private readonly onMessageCommitted: (message: SocialMessage, payload: CascadePayload) => Promise<void> = async () => {}, private readonly maxConcurrentExecutions = 4, private readonly environmentForActor: (actor: SocialActor) => Promise<string | undefined> = async () => undefined, private readonly decisionExecutor = new SocialDecisionExecutor(store, events), private readonly decisionDefinitionsForActor: (actor: SocialActor, intention: SocialIntention) => Promise<DecisionToolDefinition[]> = async () => []) {}

  /** Stop future claims and abort active provider calls. */
  public stop(): void { this.stopped = true; if (this.wakeTimer) clearTimeout(this.wakeTimer); this.wakeTimer = undefined; for (const controller of this.activeControllers) controller.abort(); }
  /** Start or wake the scheduler without awaiting the cascade from an HTTP request. */
  public kick(): void { if (this.stopped) return; if (this.running) { this.kickRequested = true; return; } this.running = true; this.drainPromise = this.drain().finally(() => { this.running = false; this.drainPromise = undefined; if (this.kickRequested && !this.stopped) { this.kickRequested = false; this.kick(); } }); }
  /** Wait until currently claimed bounded work has finished. */
  public async waitForIdle(): Promise<void> { await this.drainPromise; }
  /** Drain all currently eligible durable intentions, including model cascades. */
  private async drain(): Promise<void> { while (!this.stopped) { const tasks: Promise<void>[] = []; for (let index = 0; index < this.maxConcurrentExecutions; index += 1) { const intention = await this.store.claimNextIntention(); if (!intention) break; tasks.push(this.execute(intention)); } if (!tasks.length) { await this.scheduleWake(); return; } await Promise.all(tasks); } }
  /** Execute one intention under the actor lane and, only for channel reactions, a channel lane. */
  private async execute(intention: SocialIntention): Promise<void> {
    const scope = executionScopes[intention.kind]; const actorLane = this.lanes.get(intention.actorId); const controller = new AbortController(); this.activeControllers.add(controller);
    if (!scope) { await this.store.cancelIntention(intention.id, `unknown intention kind: ${intention.kind}`); this.activeControllers.delete(controller); return; }
    if (!actorLane) { await this.store.cancelIntention(intention.id, 'actor lane unavailable'); this.activeControllers.delete(controller); return; }
    const work = () => this.decide(intention, scope, controller.signal);
    try { if (scope === 'channel-reaction') { if (!intention.channelId) throw new Error('channel-reaction intention requires channelId'); const lane = this.channelLanes.get(intention.channelId) ?? new ChannelLane(); this.channelLanes.set(intention.channelId, lane); await actorLane.run(() => lane.run(work)); } else await actorLane.run(work); }
    catch (error) { const message = error instanceof Error ? error.message : String(error); if (controller.signal.aborted || /rate.?limit|temporar|timeout|network|429/i.test(message)) await this.store.deferIntention(intention.id, new Date(Date.now() + (controller.signal.aborted ? 0 : 30_000)).toISOString(), message); else await this.store.cancelIntention(intention.id, message); }
    finally { this.activeControllers.delete(controller); }
  }
  /** Build the appropriate context, generate one proposal, and apply it after validation. */
  private async decide(intention: SocialIntention, scope: SocialExecutionScope, abortSignal: AbortSignal): Promise<void> {
    const allActors = await this.actors(); const actor = allActors.find((candidate) => candidate.id === intention.actorId); if (!actor || actor.control !== 'model' || actor.status !== 'active') { await this.store.cancelIntention(intention.id, 'actor is not an active model SocialActor'); return; }
    const memory = await this.store.getMemory(actor.id); const environment = await this.environmentForActor(actor); const definitions = await this.decisionDefinitionsForActor(actor, intention); let context;
    if (scope === 'channel-reaction') { const channelId = intention.channelId!; const visibleActors = await this.store.listActiveActors(actor.sessionId, channelId); if (!visibleActors.some((candidate) => candidate.id === actor.id)) { await this.store.completeIntention(intention.id, 'pass:not-visible'); return; } const channel = await this.store.getChannel(actor.sessionId, channelId); const messages = (await this.store.readMessages(actor.sessionId, channelId, actor.id, 80)).messages; context = this.contextBuilder.build(actor, visibleActors, messages, intention, memory?.content, { environment, mode: intention.kind, currentChannel: channel ?? undefined, references: createSocialReferenceSet(visibleActors, channel ? [channel] : []) }); }
    else { const activity = await this.store.listVisibleActivity(actor.sessionId, actor.id, 20); context = this.contextBuilder.buildPlayerMind(actor, allActors, activity, intention, memory?.content, { environment, mode: intention.kind, references: createSocialReferenceSet(allActors, activity.map(({ channel }) => channel)) }); }
    context.decisionToolDefinitions = definitions; context.decisionTools = createSocialDecisionTools(this.toolScope(scope, intention), context.references, definitions); const startedAt = Date.now(); let diagnosticId: string | undefined;
    try {
      const run = await this.runModel(actor, context, allActors.map((candidate) => candidate.displayName), abortSignal, startedAt);
      const diagnostic = await this.store.insertDecisionDiagnostic({ intentionId: intention.id, actorId: actor.id, actorDisplayName: actor.displayName, modelRef: actor.modelRef ?? null, executionScope: scope, selectedKind: run.decision.kind, routingRefsJson: JSON.stringify(decisionRoutingSummary(run.decision)), validationOutcome: 'validated', applicationOutcome: null, error: null, latencyMs: run.latencyMs, retryCount: run.retryCount }); diagnosticId = diagnostic.id;
      const applied = await this.decisionExecutor.apply(actor, intention, run.decision, context.references); await this.store.updateDecisionDiagnostic(diagnostic.id, { applicationOutcome: applied.result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error); if (diagnosticId) await this.store.updateDecisionDiagnostic(diagnosticId, { applicationOutcome: 'error', error: message.slice(0, 500) }); else await this.store.insertDecisionDiagnostic({ intentionId: intention.id, actorId: actor.id, actorDisplayName: actor.displayName, modelRef: actor.modelRef ?? null, executionScope: scope, selectedKind: null, routingRefsJson: null, validationOutcome: 'failed', applicationOutcome: null, error: message.slice(0, 500), latencyMs: Date.now() - startedAt, retryCount: 0 }); throw error;
    }
  }

  /** Use instrumentation when the built-in executor supports it, while preserving test executors. */
  private async runModel(actor: SocialActor, context: import('../context/social-context-builder.js').SocialContextBundle, actorNames: string[], abortSignal: AbortSignal, startedAt: number): Promise<import('./social-model-executor.js').SocialDecisionRun> { const instrumented = this.modelExecutor as SocialModelExecutor & Partial<InstrumentedSocialModelExecutor>; if (typeof instrumented.decideWithTelemetry === 'function') return instrumented.decideWithTelemetry(actor, context, actorNames, abortSignal); return { decision: await this.modelExecutor.decide(actor, context, actorNames, abortSignal), retryCount: 0, latencyMs: Date.now() - startedAt }; }
  /** Map runtime execution to the intentionally small model-facing tool scopes. */
  private toolScope(scope: SocialExecutionScope, intention: SocialIntention): SocialDecisionToolScope { return intention.kind === 'invitation-decision' ? 'invitation-decision' : scope; }
  /** Read legacy/null payloads safely while retaining a bounded cascade contract. */
  private readPayload(payload: string | null): CascadePayload { if (!payload) return { rootMessageId: 0, depth: 0, count: 0 }; try { const value = JSON.parse(payload) as Partial<CascadePayload>; return { rootMessageId: typeof value.rootMessageId === 'number' ? value.rootMessageId : 0, depth: typeof value.depth === 'number' ? value.depth : 0, count: typeof value.count === 'number' ? value.count : 0 }; } catch { return { rootMessageId: 0, depth: 0, count: 0 }; } }
  /** Retain one timer for the nearest deferred intention. */
  private async scheduleWake(): Promise<void> { if (this.stopped) return; const next = await this.store.nextDeferredAt(); if (!next) return; const delay = Math.max(0, Date.parse(next) - Date.now()); if (this.wakeTimer) clearTimeout(this.wakeTimer); this.wakeTimer = setTimeout(() => { this.wakeTimer = undefined; this.kick(); }, delay); }
}
