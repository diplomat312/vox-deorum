import { ActorLane } from './actor-lane.js';
import { ChannelLane } from './channel-lane.js';
import { SocialContextBuilder } from '../context/social-context-builder.js';
import { SocialModelExecutor, type SocialDecisionExecutor } from './social-model-executor.js';
import type { SocialActor, SocialIntention, SocialMessage } from '../types.js';
import { SocialStore } from '../store/social-store.js';
import { SocialEventHub } from '../events/social-event-hub.js';

interface CascadePayload { rootMessageId: number; depth: number; count: number; }

/** Durable intention worker for autonomous social conversations. */
export class SocialScheduler {
  private readonly channelLanes = new Map<string, ChannelLane>();
  private running = false;
  private stopped = false;
  private drainPromise: Promise<void> | undefined;
  private kickRequested = false;
  private wakeTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly activeControllers = new Set<AbortController>();

  public constructor(private readonly store: SocialStore, private readonly actors: () => Promise<SocialActor[]>, private readonly lanes: Map<string, ActorLane>, private readonly events: SocialEventHub, private readonly executor: SocialDecisionExecutor = new SocialModelExecutor(), private readonly contextBuilder = new SocialContextBuilder(), private readonly onMessageCommitted: (message: SocialMessage, payload: CascadePayload) => Promise<void> = async () => {}, private readonly maxConcurrentExecutions = 4, private readonly environmentForActor: (actor: SocialActor) => Promise<string | undefined> = async () => undefined) {}

  /** Stop future claims and let the current bounded work finish. */
  public stop(): void { this.stopped = true; if (this.wakeTimer) clearTimeout(this.wakeTimer); this.wakeTimer = undefined; for (const controller of this.activeControllers) controller.abort(); }

  /** Start or wake the scheduler without awaiting the cascade from an HTTP request. */
  public kick(): void { if (this.stopped) return; if (this.running) { this.kickRequested = true; return; } this.running = true; this.drainPromise = this.drain().finally(() => { this.running = false; this.drainPromise = undefined; if (this.kickRequested && !this.stopped) { this.kickRequested = false; this.kick(); } }); }

  /** Wait until currently claimed bounded work has finished. */
  public async waitForIdle(): Promise<void> { await this.drainPromise; }

  /** Drain all currently eligible durable intentions, including AI-to-AI cascades. */
  private async drain(): Promise<void> {
    while (!this.stopped) { const tasks: Promise<void>[] = []; for (let index = 0; index < this.maxConcurrentExecutions; index += 1) { const intention = await this.store.claimNextIntention(); if (!intention) break; tasks.push(this.execute(intention)); } if (!tasks.length) { await this.scheduleWake(); return; } await Promise.all(tasks); }
  }

  /** Execute an intention with uniform actor-then-channel lane nesting. */
  private async execute(intention: SocialIntention): Promise<void> {
    if (!intention.channelId) { await this.store.completeIntention(intention.id, 'pass'); return; }
    const actorLane = this.lanes.get(intention.actorId);
    if (!actorLane) { await this.store.cancelIntention(intention.id, 'actor lane unavailable'); return; }
    const channelLane = this.channelLanes.get(intention.channelId) ?? new ChannelLane();
    this.channelLanes.set(intention.channelId, channelLane);
    const controller = new AbortController(); this.activeControllers.add(controller);
    await actorLane.run(() => channelLane.run(() => this.decide(intention, controller.signal))).catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (controller.signal.aborted || /rate.?limit|temporar|timeout|network|429/i.test(message)) await this.store.deferIntention(intention.id, new Date(Date.now() + (controller.signal.aborted ? 0 : 30_000)).toISOString(), message);
      else await this.store.cancelIntention(intention.id, message);
    }).finally(() => this.activeControllers.delete(controller));
  }

  /** Build fresh authorized context, commit speech, and propagate its listeners. */
  private async decide(intention: SocialIntention, abortSignal: AbortSignal): Promise<void> {
    const allActors = await this.actors();
    const actorSeed = allActors.find((candidate) => candidate.id === intention.actorId);
    if (!actorSeed) { await this.store.completeIntention(intention.id, 'pass'); return; }
    if (!intention.channelId) { await this.store.completeIntention(intention.id, 'pass'); return; }
    const actors = await this.store.listActiveActors(actorSeed.sessionId, intention.channelId);
    const actor = actors.find((candidate) => candidate.id === intention.actorId);
    if (!actor) { await this.store.completeIntention(intention.id, 'pass'); return; }
    const payload = this.readPayload(intention.payload);
    if (intention.cascadeId) { const reservation = await this.store.reserveCascadeRun(intention.cascadeId, actor.id); if (!reservation.allowed) { await this.store.cancelIntention(intention.id, reservation.reason ?? 'cascade-budget-exhausted'); return; } }
    const messages = (await this.store.readMessages(actor.sessionId, intention.channelId, actor.id, 80)).messages;
    const memory = await this.store.getMemory(actor.id);
    const context = this.contextBuilder.build(actor, actors, messages, intention, memory?.content, { environment: await this.environmentForActor(actor), mode: intention.kind });
    const decision = await this.executor.decide(actor, context, actors.map((candidate) => candidate.displayName), abortSignal);
    if (decision.outcome === 'pass') { const completed = await this.store.completeIntention(intention.id, 'pass'); this.events.publish({ type: 'intention-created', intention: completed }); return; }
    const mutation = await this.store.commitModelSpeech({ intentionId: intention.id, actorId: actor.id, channelId: intention.channelId, content: decision.content });
    if (mutation.message) this.events.publish({ type: 'message-added', message: mutation.message });
    for (const created of mutation.createdIntentions) this.events.publish({ type: 'intention-created', intention: created });
  }

  /** Read legacy/null payloads safely while retaining a bounded cascade. */
  private readPayload(payload: string | null): CascadePayload { if (!payload) return { rootMessageId: 0, depth: 0, count: 0 }; try { const value = JSON.parse(payload) as Partial<CascadePayload>; return { rootMessageId: typeof value.rootMessageId === 'number' ? value.rootMessageId : 0, depth: typeof value.depth === 'number' ? value.depth : 0, count: typeof value.count === 'number' ? value.count : 0 }; } catch { return { rootMessageId: 0, depth: 0, count: 0 }; } }
  /** Retain one timer for the nearest deferred intention. */
  private async scheduleWake(): Promise<void> { if (this.stopped) return; const next = await this.store.nextDeferredAt(); if (!next) return; const delay = Math.max(0, Date.parse(next) - Date.now()); if (this.wakeTimer) clearTimeout(this.wakeTimer); this.wakeTimer = setTimeout(() => { this.wakeTimer = undefined; this.kick(); }, delay); }
}
