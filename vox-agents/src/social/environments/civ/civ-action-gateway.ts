import type { CivActorBinding } from './civ-actor-binding.js';

export type CivActionCategory = 'READ' | 'NATIVE_DIPLOMACY' | 'STRATEGIC_ACTION' | 'DEV_INSPECTION';
export type CivActionState = 'REQUESTED' | 'EXECUTING' | 'CONFIRMED' | 'REFUSED' | 'FAILED' | 'UNKNOWN';
export interface CivActionAttempt { operationId: string; sessionId: string; actorId: string; gameId: string; sourceTurn: number; actionType: string; category: CivActionCategory; normalizedArguments: Record<string, string | number | boolean>; state: CivActionState; resultSummary?: string; }
export interface CivActionHandler { category: CivActionCategory; execute(binding: CivActorBinding, args: Record<string, string | number | boolean>, operationId: string): Promise<{ state: Exclude<CivActionState, 'REQUESTED' | 'EXECUTING'>; resultSummary?: string }>; }

/** Actor-bound Civ gateway with an idempotent journaled action lifecycle. */
export class CivActionGateway {
  private readonly handlers = new Map<string, CivActionHandler>();
  private readonly attempts = new Map<string, CivActionAttempt>();
  /** Register a safe read or existing native diplomacy action for future player-mind use. */
  public register(actionType: string, handler: CivActionHandler): void { if (this.handlers.has(actionType)) throw new Error(`Civ action already registered: ${actionType}`); this.handlers.set(actionType, handler); }
  /** Execute one action using structural actor binding and return authoritative lifecycle state. */
  public async invoke(binding: CivActorBinding, turn: number, actionType: string, args: Record<string, string | number | boolean>, operationId: string): Promise<CivActionAttempt> { const previous = this.attempts.get(operationId); if (previous) return previous; if ('actingPlayerId' in args) throw new Error('actingPlayerId is structurally bound and cannot be supplied'); const handler = this.handlers.get(actionType); if (!handler) throw new Error(`Unknown Civ action: ${actionType}`); if (handler.category === 'DEV_INSPECTION') throw new Error('Developer inspection actions are not model-facing'); const attempt: CivActionAttempt = { operationId, sessionId: binding.sessionId, actorId: binding.actorId, gameId: binding.gameId, sourceTurn: turn, actionType, category: handler.category, normalizedArguments: { ...args }, state: 'REQUESTED' }; this.attempts.set(operationId, attempt); attempt.state = 'EXECUTING'; try { const result = await handler.execute(binding, args, operationId); attempt.state = result.state; attempt.resultSummary = result.resultSummary; } catch (error) { attempt.state = 'FAILED'; attempt.resultSummary = error instanceof Error ? error.message : 'Civ action failed'; } return attempt; }
  /** Inspect a durable operation result without re-executing it. */
  public get(operationId: string): CivActionAttempt | undefined { return this.attempts.get(operationId); }
}
