import { ActorLane } from './actor-lane.js';
import { ChannelLane } from './channel-lane.js';
import { createSocialReferenceSet, SocialContextBuilder, type SocialReferenceSet } from '../context/social-context-builder.js';
import { defaultSocialModelExecutor, SocialDecisionExecutionError, type InstrumentedSocialModelExecutor, type SocialModelExecutor } from './social-model-executor.js';
import { decisionRoutingSummary, SocialDecisionExecutor } from './social-decision-executor.js';
import { createSocialDecisionTools, type SocialDecisionToolScope } from './social-decision-tools.js';
import type { SocialActor, SocialExecutionScope, SocialIntention } from '../types.js';
import { SocialStore } from '../store/social-store.js';
import { SocialEventHub } from '../events/social-event-hub.js';
import type { DecisionToolDefinition } from './social-decision-tools.js';

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

  public constructor(private readonly store: SocialStore, private readonly actors: () => Promise<SocialActor[]>, private readonly lanes: Map<string, ActorLane>, private readonly events: SocialEventHub, private readonly modelExecutor: SocialModelExecutor = defaultSocialModelExecutor, private readonly contextBuilder = new SocialContextBuilder(), private readonly maxConcurrentExecutions = 4, private readonly environmentForActor: (actor: SocialActor) => Promise<string | undefined> = async () => undefined, private readonly decisionExecutor = new SocialDecisionExecutor(store, events), private readonly decisionDefinitionsForActor: (actor: SocialActor, intention: SocialIntention) => Promise<DecisionToolDefinition[]> = async () => []) {}

  /** Stop future claims and abort active provider calls. */
  public stop(): void { this.stopped = true; if (this.wakeTimer) clearTimeout(this.wakeTimer); this.wakeTimer = undefined; for (const controller of this.activeControllers) controller.abort(); }
  /** Start or wake the scheduler without awaiting the cascade from an HTTP request. */
  public kick(): void { if (this.stopped) return; if (this.running) { this.kickRequested = true; return; } this.running = true; this.drainPromise = this.drain().finally(() => { this.running = false; this.drainPromise = undefined; if (this.kickRequested && !this.stopped) { this.kickRequested = false; this.kick(); } }); }
  /** Wait until currently claimed bounded work has finished. */
  public async waitForIdle(timeoutMs = 90_000): Promise<{ settled: boolean; timedOut: boolean }> { return this.waitForSettled(timeoutMs); }
  /** Wait only for work already executing so shutdown does not wait on deferred retries. */
  public async waitForDrain(timeoutMs = 15_000): Promise<{ settled: boolean; timedOut: boolean }> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (this.running) {
      const current = this.drainPromise;
      if (!current) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.max(1, deadline - Date.now()));
        void current.then(() => { clearTimeout(timer); resolve(); }, () => { clearTimeout(timer); resolve(); });
      });
      if (Date.now() >= deadline && this.running) return { settled: false, timedOut: true };
    }
    return { settled: true, timedOut: false };
  }
  /** Wait for the complete session intention set to settle, including deferred retries. */
  public async waitForSettled(timeoutMs = 90_000): Promise<{ settled: boolean; timedOut: boolean }> {
    this.kick();
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (true) {
      while (this.drainPromise) { const current = this.drainPromise; if (!await this.waitForPromise(current, deadline)) return { settled: false, timedOut: true }; }
      if (!await this.store.hasUnsettledIntentions((await this.actors())[0]?.sessionId ?? '')) return { settled: true, timedOut: false };
      if (Date.now() >= deadline) return { settled: false, timedOut: true };
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))));
      this.kick();
    }
  }
  /** Await one scheduler drain only until the caller's settlement deadline. */
  private async waitForPromise(promise: Promise<void>, deadline: number): Promise<boolean> { const remaining = deadline - Date.now(); if (remaining <= 0) return false; return new Promise<boolean>((resolve) => { const timer = setTimeout(() => resolve(false), remaining); void promise.then(() => { clearTimeout(timer); resolve(true); }, () => { clearTimeout(timer); resolve(true); }); }); }
  /** Wait for one durable cascade to reach completed, exhausted, or cancelled. */
  public async waitForCascadeSettled(cascadeId: string, timeoutMs = 90_000): Promise<{ cascade: import('../types.js').SocialCascade | undefined; settled: boolean; timedOut: boolean }> {
    this.kick();
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (true) {
      const cascade = await this.store.settleCascade(cascadeId);
      if (!cascade || cascade.state !== 'active') return { cascade, settled: true, timedOut: false };
      if (Date.now() >= deadline) return { cascade, settled: false, timedOut: true };
      await new Promise((resolve) => setTimeout(resolve, Math.min(100, Math.max(1, deadline - Date.now()))));
    }
  }
  /** Drain all currently eligible durable intentions, including model cascades. */
  private async drain(): Promise<void> { while (!this.stopped) { const tasks: Promise<void>[] = []; for (let index = 0; index < this.maxConcurrentExecutions; index += 1) { const intention = await this.store.claimNextIntention(); if (!intention) break; tasks.push(this.execute(intention)); } if (!tasks.length) { await this.scheduleWake(); return; } await Promise.all(tasks); } }
  /** Execute one intention under the actor lane and, only for channel reactions, a channel lane. */
  private async execute(intention: SocialIntention): Promise<void> {
    const scope = executionScopes[intention.kind]; const actorLane = this.lanes.get(intention.actorId); const controller = new AbortController(); this.activeControllers.add(controller);
    if (!scope) { await this.store.cancelIntention(intention.id, `unknown intention kind: ${intention.kind}`); this.activeControllers.delete(controller); return; }
    if (!actorLane) { await this.store.cancelIntention(intention.id, 'actor lane unavailable'); this.activeControllers.delete(controller); return; }
    const work = async (): Promise<void> => { const latest = await this.store.getIntention(intention.id); if (!latest || latest.state !== 'running') return; await this.decide(latest, scope, controller.signal); };
    try { if (scope === 'channel-reaction') { if (!intention.channelId) throw new Error('channel-reaction intention requires channelId'); const lane = this.channelLanes.get(intention.channelId) ?? new ChannelLane(); this.channelLanes.set(intention.channelId, lane); await actorLane.run(() => lane.run(work)); } else await actorLane.run(work); }
    catch (error) { const message = error instanceof Error ? error.message : String(error); if (controller.signal.aborted || /rate.?limit|temporar|timeout|network|429/i.test(message)) await this.store.deferIntention(intention.id, new Date(Date.now() + (controller.signal.aborted ? 0 : 30_000)).toISOString(), message); else await this.store.cancelIntention(intention.id, message); }
    finally { this.activeControllers.delete(controller); if (intention.cascadeId) await this.store.settleCascade(intention.cascadeId); }
  }
  /** Build the appropriate context, generate one proposal, and apply it after validation. */
  private async decide(intention: SocialIntention, scope: SocialExecutionScope, abortSignal: AbortSignal): Promise<void> {
    const allActors = await this.actors(); const actor = allActors.find((candidate) => candidate.id === intention.actorId); if (!actor || actor.control !== 'model' || actor.status !== 'active') { await this.store.cancelIntention(intention.id, 'actor is not an active model SocialActor'); return; }
    if (intention.cascadeId) {
      const reservation = await this.store.reserveCascadeRun(intention.cascadeId, actor.id, undefined, intention.kind === 'invitation-decision');
      if (!reservation.allowed) { await this.store.completeIntention(intention.id, `pass:${reservation.reason ?? 'cascade-budget-exhausted'}`); if (reservation.reason?.includes('exhausted') || reservation.reason === 'cascade-inactive') await this.store.exhaustCascade(intention.cascadeId, reservation.reason); await this.store.insertDecisionDiagnostic({ intentionId: intention.id, actorId: actor.id, actorDisplayName: actor.displayName, modelRef: actor.modelRef ?? null, executionScope: scope, cascadeId: intention.cascadeId ?? null, selectedKind: null, routingRefsJson: null, validationOutcome: 'skipped-budget', applicationOutcome: 'skipped', error: reservation.reason ?? 'cascade-budget-exhausted', providerLatencyMs: null, queueWaitMs: this.queueWaitMs(intention), durationMs: this.intentionDurationMs(intention), inputTokens: null, outputTokens: null, totalTokens: null, cachedTokens: null, reasoningTokens: null, cost: null, retryCount: 0 }); return; }
    }
    const frozenIntention = await this.store.markModelStarted(intention.id);
    const memory = await this.store.getMemory(actor.id); const environment = await this.environmentForActor(actor); const definitions = await this.decisionDefinitionsForActor(actor, frozenIntention); let context;
    if (scope === 'channel-reaction') { const channelId = frozenIntention.channelId!; const visibleActors = await this.store.listActiveActors(actor.sessionId, channelId); if (!visibleActors.some((candidate) => candidate.id === actor.id)) { await this.store.completeIntention(frozenIntention.id, 'pass:not-visible'); return; } const channel = await this.store.getChannel(actor.sessionId, channelId); const messages = (await this.store.readMessages(actor.sessionId, channelId, actor.id, 80, undefined, false, frozenIntention.sourceMessageId ?? undefined)).messages; context = this.contextBuilder.build(actor, visibleActors, messages, frozenIntention, memory?.content, { environment, mode: 'new-message', currentChannel: channel ?? undefined, references: createSocialReferenceSet(visibleActors, channel ? [channel] : []) }); }
    else { const activity = await this.store.listVisibleActivity(actor.sessionId, actor.id, 20); context = this.contextBuilder.buildPlayerMind(actor, allActors, activity, frozenIntention, memory?.content, { environment, mode: frozenIntention.kind, references: createSocialReferenceSet(allActors, activity.map(({ channel }) => channel)) }); }
    context.references = await this.legalReferences(actor, context.references); context.decisionToolDefinitions = definitions; context.decisionTools = createSocialDecisionTools(this.toolScope(scope, frozenIntention), context.references, definitions); const providerStartedAt = Date.now(); let diagnosticId: string | undefined;
    try {
      const run = await this.runModel(actor, context, allActors.map((candidate) => candidate.displayName), abortSignal, providerStartedAt);
      const diagnostic = await this.store.insertDecisionDiagnostic({ intentionId: frozenIntention.id, actorId: actor.id, actorDisplayName: actor.displayName, modelRef: actor.modelRef ?? null, executionScope: scope, cascadeId: frozenIntention.cascadeId ?? null, selectedKind: run.decision.kind, routingRefsJson: JSON.stringify(decisionRoutingSummary(run.decision)), validationOutcome: 'validated', applicationOutcome: null, error: null, providerLatencyMs: run.latencyMs, queueWaitMs: this.queueWaitMs(frozenIntention), durationMs: this.intentionDurationMs(frozenIntention), inputTokens: run.usage?.inputTokens ?? null, outputTokens: run.usage?.outputTokens ?? null, totalTokens: run.usage?.totalTokens ?? null, cachedTokens: run.usage?.cachedTokens ?? null, reasoningTokens: run.usage?.reasoningTokens ?? null, cost: run.usage?.cost ?? null, retryCount: run.retryCount, semanticRetryCount: run.semanticRetryCount ?? run.retryCount, providerAttemptCount: run.providerAttemptCount ?? 1, providerRetryCount: run.providerRetryCount ?? 0, providerFailureClass: run.providerFailureClass ?? null }); diagnosticId = diagnostic.id;
      const applied = await this.decisionExecutor.apply(actor, frozenIntention, run.decision, context.references); await this.store.updateDecisionDiagnostic(diagnostic.id, { applicationOutcome: applied.result, durationMs: this.intentionDurationMs(frozenIntention) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error); const telemetry = error instanceof SocialDecisionExecutionError ? error.telemetry : undefined; if (diagnosticId) await this.store.updateDecisionDiagnostic(diagnosticId, { applicationOutcome: 'error', error: message.slice(0, 500), durationMs: this.intentionDurationMs(frozenIntention) }); else await this.store.insertDecisionDiagnostic({ intentionId: frozenIntention.id, actorId: actor.id, actorDisplayName: actor.displayName, modelRef: actor.modelRef ?? null, executionScope: scope, cascadeId: frozenIntention.cascadeId ?? null, selectedKind: null, routingRefsJson: null, validationOutcome: 'failed', applicationOutcome: null, error: message.slice(0, 500), providerLatencyMs: telemetry?.latencyMs ?? Date.now() - providerStartedAt, queueWaitMs: this.queueWaitMs(frozenIntention), durationMs: this.intentionDurationMs(frozenIntention), inputTokens: null, outputTokens: null, totalTokens: null, cachedTokens: null, reasoningTokens: null, cost: null, retryCount: telemetry?.retryCount ?? 0, semanticRetryCount: telemetry?.semanticRetryCount ?? 0, providerAttemptCount: telemetry?.providerAttemptCount ?? 0, providerRetryCount: telemetry?.providerRetryCount ?? 0, providerFailureClass: telemetry?.providerFailureClass ?? null, providerHttpStatus: telemetry?.providerHttpStatus ?? null, providerErrorType: telemetry?.providerErrorType ?? null, providerErrorCode: telemetry?.providerErrorCode ?? null, providerErrorSummary: telemetry?.providerErrorSummary ?? null }); throw error;
    }
  }

  /** Use instrumentation when the built-in executor supports it, while preserving test executors. */
  private async runModel(actor: SocialActor, context: import('../context/social-context-builder.js').SocialContextBundle, actorNames: string[], abortSignal: AbortSignal, startedAt: number): Promise<import('./social-model-executor.js').SocialDecisionRun> { const instrumented = this.modelExecutor as SocialModelExecutor & Partial<InstrumentedSocialModelExecutor>; if (typeof instrumented.decideWithTelemetry === 'function') return instrumented.decideWithTelemetry(actor, context, actorNames, abortSignal); return { decision: await this.modelExecutor.decide(actor, context, actorNames, abortSignal), retryCount: 0, latencyMs: Date.now() - startedAt }; }
  /** Map runtime execution to the intentionally small model-facing tool scopes. */
  private toolScope(scope: SocialExecutionScope, intention: SocialIntention): SocialDecisionToolScope { return intention.kind === 'invitation-decision' ? 'invitation-decision' : scope; }
  /** Limit model-facing references to actions the actor can legally perform now. */
  private async legalReferences(actor: SocialActor, references: SocialReferenceSet): Promise<SocialReferenceSet> {
    const dmActors = references.actors.filter((candidate) => candidate.id !== actor.id);
    const groupParticipants = dmActors;
    const messageRooms = references.channels.filter((candidate) => candidate.id === 'world' || candidate.kind === 'dm' || candidate.kind === 'group');
    const groupRooms = references.channels.filter((candidate) => candidate.kind === 'group');
    const leaveRooms = (await Promise.all(groupRooms.map(async (room) => (await this.store.isActiveMember(room.id, actor.id) ? room : undefined)))).filter((room): room is NonNullable<typeof room> => room !== undefined);
    const inviteRooms = leaveRooms;
    const inviteTargets = (await Promise.all(inviteRooms.map(async (room) => { const participantRefs = (await Promise.all(dmActors.map(async (candidate) => (await this.store.isActiveOrInvitedMember(room.id, candidate.id) ? undefined : candidate.ref)))).filter((ref): ref is string => ref !== undefined); return participantRefs.length ? { roomRef: room.ref, participantRefs } : undefined; }))).filter((target): target is NonNullable<typeof target> => target !== undefined);
    const eligibleRefs = [...new Set(inviteTargets.flatMap((target) => target.participantRefs))];
    const eligible = dmActors.filter((candidate) => eligibleRefs.includes(candidate.ref));
    return { ...references, dmActors, groupParticipants, messageRooms, inviteRooms: inviteTargets.length ? inviteRooms : [], inviteParticipants: eligible, inviteTargets, leaveRooms };
  }
  /** Measure durable wait before a claimed intention began its provider decision. */
  private queueWaitMs(intention: SocialIntention): number { const started = intention.modelStartedAt ? Date.parse(intention.modelStartedAt) : Date.now(); const created = Date.parse(intention.createdAt); return Number.isFinite(created) ? Math.max(0, started - created) : 0; }
  /** Measure the complete durable intention lifetime for diagnostics. */
  private intentionDurationMs(intention: SocialIntention): number { const created = Date.parse(intention.createdAt); return Number.isFinite(created) ? Math.max(0, Date.now() - created) : 0; }
  /** Retain one timer for the nearest deferred intention. */
  private async scheduleWake(): Promise<void> { if (this.stopped) return; const next = await this.store.nextDeferredAt(); if (!next) return; const delay = Math.max(0, Date.parse(next) - Date.now()); if (this.wakeTimer) clearTimeout(this.wakeTimer); this.wakeTimer = setTimeout(() => { this.wakeTimer = undefined; this.kick(); }, delay); }
}
