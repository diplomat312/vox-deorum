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

  public constructor(private readonly store: SocialStore, private readonly actors: () => Promise<SocialActor[]>, private readonly lanes: Map<string, ActorLane>, private readonly events: SocialEventHub, private readonly executor: SocialDecisionExecutor = new SocialModelExecutor(), private readonly contextBuilder = new SocialContextBuilder(), private readonly onMessageCommitted: (message: SocialMessage, payload: CascadePayload) => Promise<void> = async () => {}, private readonly maxCascadeMessages = 12) {}

  /** Stop future claims and let the current bounded work finish. */
  public stop(): void { this.stopped = true; }

  /** Start or wake the scheduler without awaiting the cascade from an HTTP request. */
  public kick(): void { if (this.running || this.stopped) return; this.running = true; this.drainPromise = this.drain().finally(() => { this.running = false; this.drainPromise = undefined; }); }

  /** Wait until currently claimed bounded work has finished. */
  public async waitForIdle(): Promise<void> { await this.drainPromise; }

  /** Drain all currently eligible durable intentions, including AI-to-AI cascades. */
  private async drain(): Promise<void> {
    let processed = 0;
    while (!this.stopped && processed < this.maxCascadeMessages) {
      const intention = await this.store.claimNextIntention();
      if (!intention) return;
      processed += 1;
      await this.execute(intention);
    }
  }

  /** Execute an intention with uniform actor-then-channel lane nesting. */
  private async execute(intention: SocialIntention): Promise<void> {
    if (!intention.channelId) { await this.store.completeIntention(intention.id, 'pass'); return; }
    const actorLane = this.lanes.get(intention.actorId);
    if (!actorLane) { await this.store.cancelIntention(intention.id, 'actor lane unavailable'); return; }
    const channelLane = this.channelLanes.get(intention.channelId) ?? new ChannelLane();
    this.channelLanes.set(intention.channelId, channelLane);
    await actorLane.run(() => channelLane.run(() => this.decide(intention))).catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      if (/rate.?limit|temporar|timeout|network|429/i.test(message)) await this.store.deferIntention(intention.id, new Date(Date.now() + 30_000).toISOString(), message);
      else await this.store.cancelIntention(intention.id, message);
    });
  }

  /** Build fresh authorized context, commit speech, and propagate its listeners. */
  private async decide(intention: SocialIntention): Promise<void> {
    const allActors = await this.actors();
    const actorSeed = allActors.find((candidate) => candidate.id === intention.actorId);
    if (!actorSeed) { await this.store.completeIntention(intention.id, 'pass'); return; }
    if (!intention.channelId) { await this.store.completeIntention(intention.id, 'pass'); return; }
    const actors = await this.store.listActiveActors(actorSeed.sessionId, intention.channelId);
    const actor = actors.find((candidate) => candidate.id === intention.actorId);
    if (!actor) { await this.store.completeIntention(intention.id, 'pass'); return; }
    const payload = this.readPayload(intention.payload);
    const messages = (await this.store.readMessages(actor.sessionId, intention.channelId, actor.id, 80)).messages;
    const memory = await this.store.getMemory(actor.id);
    const context = this.contextBuilder.build(actor, actors, messages, intention, memory?.content);
    const decision = await this.executor.decide(actor, context, actors.map((candidate) => candidate.displayName));
    await this.store.completeIntention(intention.id, decision.outcome);
    if (decision.outcome === 'speak') {
      const reply = await this.store.appendMessage({ sessionId: actor.sessionId, actorId: actor.id, channelId: intention.channelId, content: decision.content, intentionId: intention.id, idempotencyKey: `social-intention:${intention.id}` });
      this.events.publish({ type: 'message-added', message: reply });
      if (payload.count < this.maxCascadeMessages) await this.onMessageCommitted(reply, { rootMessageId: payload.rootMessageId, depth: payload.depth + 1, count: payload.count + 1 });
    }
  }

  /** Read legacy/null payloads safely while retaining a bounded cascade. */
  private readPayload(payload: string | null): CascadePayload { if (!payload) return { rootMessageId: 0, depth: 0, count: 0 }; try { const value = JSON.parse(payload) as Partial<CascadePayload>; return { rootMessageId: typeof value.rootMessageId === 'number' ? value.rootMessageId : 0, depth: typeof value.depth === 'number' ? value.depth : 0, count: typeof value.count === 'number' ? value.count : 0 }; } catch { return { rootMessageId: 0, depth: 0, count: 0 }; } }
}
