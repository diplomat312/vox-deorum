import type { EnvironmentEvent } from './environment-adapter.js';
import type { SocialStore } from '../store/social-store.js';

/** Durable event journal contract used to deduplicate environment stimuli across reconnects. */
export interface EnvironmentEventJournal { has(sourceKey: string): Promise<boolean>; record(event: EnvironmentEvent): Promise<boolean | void>; }

/** Minimal journal implementation for deterministic tests and process-local adapters. */
export class MemoryEnvironmentEventJournal implements EnvironmentEventJournal {
  private readonly keys = new Set<string>();
  /** Check whether an event provenance key was already ingested. */
  public async has(sourceKey: string): Promise<boolean> { return this.keys.has(sourceKey); }
  /** Record one event provenance key after its consumer accepts it. */
  public async record(event: EnvironmentEvent): Promise<boolean> { if (this.keys.has(event.sourceKey)) return false; this.keys.add(event.sourceKey); return true; }
}

/** Durable environment-event journal backed by the social session SQLite store. */
export class SocialStoreEnvironmentEventJournal implements EnvironmentEventJournal {
  public constructor(private readonly store: SocialStore, private readonly sessionId: string, private readonly environmentType: string) {}
  /** Check a source key in the owning session. */
  public async has(sourceKey: string): Promise<boolean> { return this.store.hasEnvironmentEvent(this.sessionId, sourceKey); }
  /** Persist only normalized event fields required for replay-safe routing. */
  public async record(event: EnvironmentEvent): Promise<boolean> { return this.store.recordEnvironmentEvent({ sessionId: this.sessionId, environmentType: this.environmentType, gameId: event.gameId, sourceKey: event.sourceKey, turn: event.turn, eventType: event.type, sourcePlayerId: event.sourcePlayerId, targetPlayerId: event.targetPlayerId, normalizedPayloadJson: JSON.stringify(event.payload), occurredAt: event.occurredAt }); }
}
