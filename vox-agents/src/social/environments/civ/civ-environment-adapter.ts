import type { EnvironmentAdapter, EnvironmentEvent, EnvironmentSnapshot } from '../environment-adapter.js';
import type { EnvironmentEventJournal } from '../environment-event.js';
import type { SocialActor } from '../../types.js';
import type { SocialReferenceSet } from '../../context/social-context-builder.js';
import { bindCivActors, type CivActorBinding, type CivSeat } from './civ-actor-binding.js';
import type { CivMcpPort } from './civ-mcp-port.js';
import type { GameEventNotification } from '../../../utils/models/mcp-client.js';
import { createLogger } from '../../../utils/logger.js';

export interface CivSnapshot extends EnvironmentSnapshot { environment: 'civ5'; seats: CivSeat[]; normalizedState: Record<string, string | number | boolean>; }
export interface CivBindingPersistence { list(sessionId: string, environmentType: string, gameId?: string): Promise<Array<Pick<CivActorBinding, 'actorId' | 'playerId'> & { gameId?: string }>>; reconcile(bindings: CivActorBinding[]): Promise<void>; }

/** Event classes whose normalized facts have a defined political visibility projection. */
export const civCognitionEventTypes = new Set(['CityFounded', 'CityCaptureComplete', 'CityFlipped', 'CityLiberated', 'city-lost', 'city-captured', 'PlayerVictory', 'PlayerDefeated', 'WarDeclared', 'PeaceMade', 'WonderBuilt']);

/** Return whether an event is safe to turn into an autonomous cognition wake. */
export function isCivCognitionEventType(type: string): boolean { return civCognitionEventTypes.has(type); }

// No event is assumed globally visible until the underlying Civ projection proves that fact.
const publicCognitionEventTypes = new Set<string>();

/** Civ environment adapter that owns binding reconciliation and the existing MCP notification subscription. */
export class CivEnvironmentAdapter implements EnvironmentAdapter<CivSnapshot> {
  private readonly logger = createLogger('civ-environment-adapter');
  private sessionId: string | undefined;
  private currentSnapshot: CivSnapshot | undefined;
  private readonly bindings = new Map<string, CivActorBinding>();
  private removeNotificationListener: (() => void) | undefined;
  public constructor(private journal: EnvironmentEventJournal, private onEvent: (event: EnvironmentEvent) => Promise<void> = async () => {}, private persistence?: CivBindingPersistence) {}

  /** Replace process-local test collaborators with the runtime's durable session collaborators. */
  public configurePersistence(journal: EnvironmentEventJournal, persistence: CivBindingPersistence, onEvent: (event: EnvironmentEvent) => Promise<void>): void { this.journal = journal; this.persistence = persistence; this.onEvent = onEvent; }

  /** Attach a game snapshot, reconcile stored bindings, and reject unsafe seat remaps. */
  public async attach(sessionId: string, snapshot: CivSnapshot, actors: SocialActor[] = [], actorSeatById: Record<string, number> = {}): Promise<void> { if (snapshot.environment !== 'civ5' || !snapshot.gameId || !Number.isSafeInteger(snapshot.turn)) throw new Error('Invalid Civ environment snapshot'); if (this.currentSnapshot && this.currentSnapshot.gameId !== snapshot.gameId) throw new Error(`Cannot rebind social session from game ${this.currentSnapshot.gameId} to ${snapshot.gameId}`); const nextBindings = bindCivActors(sessionId, snapshot.gameId, actors, snapshot.seats, actorSeatById); const saved = await this.persistence?.list(sessionId, snapshot.environment) ?? []; for (const prior of saved) { if (prior.gameId && prior.gameId !== snapshot.gameId) throw new Error(`Cannot attach Civ game ${snapshot.gameId}; persisted session belongs to game ${prior.gameId}`); const next = nextBindings.find((binding) => binding.actorId === prior.actorId); if (next && next.playerId !== prior.playerId) throw new Error(`Unsafe Civ actor-seat remap for ${prior.actorId}: stored player ${prior.playerId}, live player ${next.playerId}`); } await this.persistence?.reconcile(nextBindings); this.sessionId = sessionId; this.currentSnapshot = snapshot; this.bindings.clear(); for (const binding of nextBindings) this.bindings.set(binding.actorId, binding); }
  /** Subscribe once to the canonical MCP notification stream. */
  public start(port: CivMcpPort): void { if (this.removeNotificationListener) return; this.removeNotificationListener = port.onNotification((notification) => { void this.ingestNotification(notification).catch((error) => { this.logger.warn('Could not ingest Civ environment notification', { gameId: notification.gameID, turn: notification.turn, event: notification.event, error }); }); }); }
  /** Detach from MCP notifications without affecting the shared client. */
  public detach(): void { this.removeNotificationListener?.(); this.removeNotificationListener = undefined; }
  /** Return the current authoritative environment snapshot. */
  public async snapshot(): Promise<CivSnapshot> { if (!this.currentSnapshot) throw new Error('No Civ environment is attached'); return this.currentSnapshot; }
  /** Refresh the bounded snapshot while preserving the established game and seat bindings. */
  public updateSnapshot(snapshot: CivSnapshot): void { if (!this.currentSnapshot) throw new Error('No Civ environment is attached'); if (snapshot.environment !== 'civ5' || snapshot.gameId !== this.currentSnapshot.gameId || snapshot.turn < this.currentSnapshot.turn) throw new Error('Invalid Civ environment snapshot update'); this.currentSnapshot = { ...snapshot, seats: snapshot.seats.map((seat) => ({ ...seat, knownPlayerIds: seat.knownPlayerIds ? [...seat.knownPlayerIds] : undefined })) }; }
  /** Ingest one unseen normalized event and wake its bound actor after durable dedupe. */
  public async ingest(event: EnvironmentEvent): Promise<boolean> { const snapshot = await this.snapshot(); if (event.gameId !== snapshot.gameId) throw new Error('Environment event game ID does not match attached game'); if (!isCivCognitionEventType(event.type)) return false; if (await this.journal.has(event.sourceKey)) return false; const recorded = await this.journal.record(event); if (recorded === false) return false; await this.onEvent(event); return true; }
  /** Return the stable binding for an actor. */
  public binding(actorId: string): CivActorBinding { const binding = this.bindings.get(actorId); if (!binding || !binding.active) throw new Error(`No active Civ binding for actor ${actorId}`); return binding; }
  /** Return all current social actor bindings. Native-VP-only seats remain outside this list. */
  public listBindings(): CivActorBinding[] { return [...this.bindings.values()].sort((a, b) => a.ordinal - b.ordinal); }
  /** Return all live Civ seats for UI/environment inspection, including non-social participants. */
  public async listParticipants(): Promise<CivSeat[]> { return (await this.snapshot()).seats.map((seat) => ({ ...seat })); }
  /** Return actor IDs eligible for a factual event without exposing event payloads. */
  public eventRecipientActorIds(event: EnvironmentEvent): string[] { if (!isCivCognitionEventType(event.type)) return []; const bindings = this.listBindings(); if (publicCognitionEventTypes.has(event.type)) return bindings.map((binding) => binding.actorId); const ids = new Set<string>(); for (const binding of bindings) { if (binding.playerId === event.sourcePlayerId || binding.playerId === event.targetPlayerId || this.knowsPlayer(binding.playerId, event.sourcePlayerId) || this.knowsPlayer(binding.playerId, event.targetPlayerId)) ids.add(binding.actorId); } return [...ids]; }
  /** Restrict model-visible references to the bound civilization and authoritative contacts. */
  public async filterReferencesForActor(actor: SocialActor, references: SocialReferenceSet): Promise<SocialReferenceSet> { const binding = this.binding(actor.id); const allowed = new Set([binding.playerId, ...(this.seat(binding.playerId)?.knownPlayerIds ?? [])]); const visibleActors = references.actors.filter((reference) => { const candidate = this.bindings.get(reference.id); return candidate ? allowed.has(candidate.playerId) : reference.id === actor.id; }); const visibleIds = new Set(visibleActors.map((reference) => reference.id)); const filterParticipants = (items = references.actors) => items.filter((reference) => visibleIds.has(reference.id)); const filterTargets = (targets = references.inviteTargets ?? []) => targets.map((target) => ({ ...target, participantRefs: target.participantRefs.filter((reference) => visibleActors.some((candidate) => candidate.ref === reference)) })).filter((target) => target.participantRefs.length > 0); return { ...references, actors: visibleActors, dmActors: filterParticipants(references.dmActors), groupParticipants: filterParticipants(references.groupParticipants), inviteParticipants: filterParticipants(references.inviteParticipants), inviteTargets: filterTargets() }; }
  /** Restrict downstream fanout to contacts known by the speaking civilization. */
  public async filterRecipientActorIds(actor: SocialActor, _channelId: string, recipientActorIds: string[]): Promise<string[]> { const binding = this.binding(actor.id); const allowed = new Set([binding.playerId, ...(this.seat(binding.playerId)?.knownPlayerIds ?? [])]); return recipientActorIds.filter((actorId) => { const target = this.bindings.get(actorId); return target ? allowed.has(target.playerId) : false; }); }
  /** Reject direct social targeting when the target is outside the authoritative contact graph. */
  public async isActorReachable(actor: SocialActor, targetActorId: string): Promise<boolean> { const source = this.binding(actor.id); const target = this.bindings.get(targetActorId); return Boolean(target && target.playerId !== source.playerId && (this.seat(source.playerId)?.knownPlayerIds ?? []).includes(target.playerId)); }
  /** Return the attached session identifier. */
  public getSessionId(): string { if (!this.sessionId) throw new Error('No Civ environment is attached'); return this.sessionId; }
  /** Convert a canonical MCP notification into a bounded environment event. */
  private async ingestNotification(notification: GameEventNotification): Promise<void> { const snapshot = await this.snapshot(); const gameId = notification.gameID ?? this.stringValue(notification.data?.gameID); if (!gameId || gameId !== snapshot.gameId || !isCivCognitionEventType(notification.event)) return; const sourceKey = `${gameId}:${notification.latestID}`; const sourcePlayerId = this.numberValue(notification.playerID); const targetPlayerId = this.numberValue(notification.data?.targetPlayerID ?? notification.data?.TargetPlayerID); const actorId = this.bindingsByPlayer(sourcePlayerId)?.actorId; await this.ingest({ gameId, turn: notification.turn, type: notification.event, sourceKey, actorId, sourcePlayerId, targetPlayerId, payload: this.normalizePayload(notification.data) }); }
  /** Find the social actor affected by an authoritative Civ player ID. */
  private bindingsByPlayer(playerId: number): CivActorBinding | undefined { return [...this.bindings.values()].find((binding) => binding.playerId === playerId); }
  /** Keep only small primitive event fields and exclude transcript-like content. */
  private normalizePayload(data: Record<string, unknown> | undefined): Record<string, string | number | boolean> { const allowed = /^(city|cityId|cityName|sourcePlayerID|targetPlayerID|teamID|turn|phase|resolution|dealId|proposalMessageId|victory|capital)/i; return Object.fromEntries(Object.entries(data ?? {}).filter(([key, value]) => allowed.test(key) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')).map(([key, value]) => [key, value as string | number | boolean])); }
  /** Read an optional numeric notification field safely. */
  private numberValue(value: unknown): number { return typeof value === 'number' ? value : -1; }
  /** Read an optional string notification field safely. */
  private stringValue(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
  /** Return one authoritative Civ seat by player ID. */
  private seat(playerId: number): CivSeat | undefined { return this.currentSnapshot?.seats.find((candidate) => candidate.playerId === playerId); }
  /** Check an authoritative contact edge without using political interpretation. */
  private knowsPlayer(observerPlayerId: number | undefined, targetPlayerId: number | undefined): boolean { return observerPlayerId !== undefined && targetPlayerId !== undefined && targetPlayerId >= 0 && (this.seat(observerPlayerId)?.knownPlayerIds ?? []).includes(targetPlayerId); }
}
