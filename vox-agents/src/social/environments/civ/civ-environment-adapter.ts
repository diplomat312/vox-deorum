import type { EnvironmentAdapter, EnvironmentEvent, EnvironmentSnapshot } from '../environment-adapter.js';
import type { EnvironmentEventJournal } from '../environment-event.js';
import type { SocialActor } from '../../types.js';
import { bindCivActors, type CivActorBinding, type CivSeat } from './civ-actor-binding.js';

export interface CivSnapshot extends EnvironmentSnapshot { environment: 'civ5'; seats: CivSeat[]; normalizedState: Record<string, string | number | boolean>; }

/** Civ environment adapter that validates game identity and exposes stable actor bindings. */
export class CivEnvironmentAdapter implements EnvironmentAdapter<CivSnapshot> {
  private sessionId: string | undefined;
  private currentSnapshot: CivSnapshot | undefined;
  private readonly bindings = new Map<string, CivActorBinding>();
  public constructor(private readonly journal: EnvironmentEventJournal, private readonly onEvent: (event: EnvironmentEvent) => Promise<void> = async () => {}) {}

  /** Attach a live snapshot to one social session and reject stale game identities. */
  public async attach(sessionId: string, snapshot: CivSnapshot, actors: SocialActor[] = [], actorSeatById: Record<string, number> = {}): Promise<void> { if (snapshot.environment !== 'civ5' || !snapshot.gameId || !Number.isSafeInteger(snapshot.turn)) throw new Error('Invalid Civ environment snapshot'); if (this.currentSnapshot && this.currentSnapshot.gameId !== snapshot.gameId) throw new Error(`Cannot rebind social session from game ${this.currentSnapshot.gameId} to ${snapshot.gameId}`); const nextBindings = bindCivActors(sessionId, snapshot.gameId, actors, snapshot.seats, actorSeatById); this.sessionId = sessionId; this.currentSnapshot = snapshot; this.bindings.clear(); for (const binding of nextBindings) this.bindings.set(binding.actorId, binding); }
  /** Return the current authoritative environment snapshot. */
  public async snapshot(): Promise<CivSnapshot> { if (!this.currentSnapshot) throw new Error('No Civ environment is attached'); return this.currentSnapshot; }
  /** Ingest one unseen environment event and wake only its bound actor when applicable. */
  public async ingest(event: EnvironmentEvent): Promise<boolean> { const snapshot = await this.snapshot(); if (event.gameId !== snapshot.gameId) throw new Error('Environment event game ID does not match attached game'); if (await this.journal.has(event.sourceKey)) return false; await this.journal.record(event); await this.onEvent(event); return true; }
  /** Return the stable binding for an actor. */
  public binding(actorId: string): CivActorBinding { const binding = this.bindings.get(actorId); if (!binding || !binding.active) throw new Error(`No active Civ binding for actor ${actorId}`); return binding; }
  /** Return all current bindings for UI and diagnostics. */
  public listBindings(): CivActorBinding[] { return [...this.bindings.values()].sort((a, b) => a.ordinal - b.ordinal); }
  /** Return the attached session identifier. */
  public getSessionId(): string { if (!this.sessionId) throw new Error('No Civ environment is attached'); return this.sessionId; }
}
