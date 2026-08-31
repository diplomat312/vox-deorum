import type { EnvironmentEvent } from '../environment-adapter.js';
import type { SocialIntention } from '../../types.js';

/** Durable intention sink used to connect normalized Civ events to the generic scheduler. */
export interface CivEventIntentionSink { enqueueIntention(input: Omit<SocialIntention, 'createdAt' | 'updatedAt' | 'attemptCount' | 'lastError' | 'claimedAt' | 'result' | 'completedAt'>): Promise<SocialIntention>; }

/** Translates Civ facts into actor-bound stimuli without prescribing diplomatic behavior. */
export class CivEventBridge {
  public constructor(private readonly sink: CivEventIntentionSink) {}
  /** Enqueue one deduplicated environment stimulus for the affected model actor. */
  public async route(event: EnvironmentEvent, actorId: string): Promise<SocialIntention> { return this.sink.enqueueIntention({ id: `civ-event:${event.sourceKey}:${actorId}`, actorId, kind: 'environment-event', channelId: null, sourceMessageId: null, priority: event.type.includes('war') || event.type.includes('capital') ? 100 : 50, state: 'queued', notBefore: new Date().toISOString(), payload: JSON.stringify({ type: event.type, gameId: event.gameId, turn: event.turn, payload: event.payload }), dedupeKey: `civ-event:${event.sourceKey}:${actorId}` }); }
}
