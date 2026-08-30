import { EventEmitter } from 'node:events';
import type { SocialChannel, SocialIntention, SocialMembership, SocialMessage } from '../types.js';

export type SocialEvent =
  | { type: 'channel-created'; channel: SocialChannel }
  | { type: 'message-added'; message: SocialMessage }
  | { type: 'membership-changed'; membership: SocialMembership }
  | { type: 'intention-created'; intention: SocialIntention };

/** Session-scoped event hub that emits only after durable social mutations. */
export class SocialEventHub {
  private readonly emitter = new EventEmitter();

  /** Publish one committed social event. */
  public publish(event: SocialEvent): void { this.emitter.emit('event', event); }

  /** Subscribe to committed social events and return an unsubscribe function. */
  public subscribe(listener: (event: SocialEvent) => void): () => void { this.emitter.on('event', listener); return () => this.emitter.off('event', listener); }
}
