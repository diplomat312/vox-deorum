import { z } from 'zod';
import type { CivActorBinding } from './civ-actor-binding.js';
import type { DecisionToolDefinition } from '../../runtime/social-decision-tools.js';
import type { SocialStore } from '../../store/social-store.js';
import type { SocialCivActionAttemptRow } from '../../store/schema.js';

export type CivActionCategory = 'READ' | 'NATIVE_DIPLOMACY' | 'STRATEGIC_ACTION' | 'DEV_INSPECTION';
export type CivActionState = 'REQUESTED' | 'EXECUTING' | 'CONFIRMED' | 'REFUSED' | 'FAILED' | 'UNKNOWN';
export interface CivActionAttempt { operationId: string; sessionId: string; actorId: string; gameId: string; playerId: number; sourceTurn: number; actionType: string; category: CivActionCategory; normalizedArguments: Record<string, unknown>; state: CivActionState; requestedAt: string; executingAt?: string; completedAt?: string; resultSummary?: string; failureClass?: string; readbackSummary?: string; }
export interface CivActionExecutionResult { state: Exclude<CivActionState, 'REQUESTED' | 'EXECUTING'>; resultSummary?: string; failureClass?: string; readbackSummary?: string; }
export interface CivActionDefinition<TArgs = Record<string, unknown>> { category: CivActionCategory; description: string; inputSchema: z.ZodType<TArgs>; modelFacing: boolean; execute(binding: CivActorBinding, args: TArgs, operationId: string): Promise<CivActionExecutionResult>; reconcile?(attempt: CivActionAttempt): Promise<CivActionExecutionResult>; }
export type CivActionHandler = Partial<CivActionDefinition> & Pick<CivActionDefinition, 'category' | 'execute'>;

/** Persistent action-journal operations required by the gateway. */
export interface CivActionJournal { get(operationId: string): Promise<CivActionAttempt | undefined>; insert(attempt: CivActionAttempt): Promise<boolean>; update(operationId: string, values: Partial<CivActionAttempt>): Promise<CivActionAttempt>; listExecuting(sessionId: string): Promise<CivActionAttempt[]>; }

/** In-memory journal reserved for isolated unit tests, never used by production runtime wiring. */
export class MemoryCivActionJournal implements CivActionJournal {
  private readonly attempts = new Map<string, CivActionAttempt>();
  /** Return one test action attempt. */
  public async get(operationId: string): Promise<CivActionAttempt | undefined> { return this.attempts.get(operationId); }
  /** Insert one test action attempt idempotently. */
  public async insert(attempt: CivActionAttempt): Promise<boolean> { if (this.attempts.has(attempt.operationId)) return false; this.attempts.set(attempt.operationId, { ...attempt }); return true; }
  /** Update one test action attempt. */
  public async update(operationId: string, values: Partial<CivActionAttempt>): Promise<CivActionAttempt> { const current = this.attempts.get(operationId); if (!current) throw new Error(`Unknown Civ operation ${operationId}`); const updated = { ...current, ...values }; this.attempts.set(operationId, updated); return updated; }
  /** Return executing test attempts for recovery tests. */
  public async listExecuting(sessionId: string): Promise<CivActionAttempt[]> { return [...this.attempts.values()].filter((attempt) => attempt.sessionId === sessionId && attempt.state === 'EXECUTING'); }
}

/** Adapt the social SQLite store to the gateway's durable action-journal contract. */
export class SocialStoreCivActionJournal implements CivActionJournal {
  public constructor(private readonly store: SocialStore) {}
  /** Load one operation from SQLite. */
  public async get(operationId: string): Promise<CivActionAttempt | undefined> { const row = await this.store.getCivActionAttempt(operationId); return row ? this.fromRow(row) : undefined; }
  /** Insert a requested operation exactly once. */
  public async insert(attempt: CivActionAttempt): Promise<boolean> { return this.store.insertCivActionAttempt({ operationId: attempt.operationId, sessionId: attempt.sessionId, actorId: attempt.actorId, gameId: attempt.gameId, playerId: attempt.playerId, sourceTurn: attempt.sourceTurn, actionType: attempt.actionType, category: attempt.category, normalizedArgumentsJson: JSON.stringify(attempt.normalizedArguments), state: attempt.state, requestedAt: attempt.requestedAt }); }
  /** Update one lifecycle state in SQLite. */
  public async update(operationId: string, values: Partial<CivActionAttempt>): Promise<CivActionAttempt> { const row = await this.store.updateCivActionAttempt(operationId, { state: values.state, executingAt: values.executingAt ?? null, completedAt: values.completedAt ?? null, resultSummary: values.resultSummary ?? null, failureClass: values.failureClass ?? null, readbackSummary: values.readbackSummary ?? null }); return this.fromRow(row); }
  /** Load operations interrupted by a process restart. */
  public async listExecuting(sessionId: string): Promise<CivActionAttempt[]> { return (await this.store.listExecutingCivActionAttempts(sessionId)).map((row) => this.fromRow(row)); }
  /** Convert a SQLite action row into the gateway domain type. */
  private fromRow(row: SocialCivActionAttemptRow): CivActionAttempt { return { operationId: row.operationId, sessionId: row.sessionId, actorId: row.actorId, gameId: row.gameId, playerId: row.playerId, sourceTurn: row.sourceTurn, actionType: row.actionType, category: row.category as CivActionCategory, normalizedArguments: JSON.parse(row.normalizedArgumentsJson) as Record<string, unknown>, state: row.state as CivActionState, requestedAt: row.requestedAt, executingAt: row.executingAt ?? undefined, completedAt: row.completedAt ?? undefined, resultSummary: row.resultSummary ?? undefined, failureClass: row.failureClass ?? undefined, readbackSummary: row.readbackSummary ?? undefined }; }
}

/** Actor-bound Civ gateway whose operation journal is persistent in production. */
export class CivActionGateway {
  private readonly handlers = new Map<string, CivActionDefinition>();
  public constructor(private readonly journal: CivActionJournal) {}
  /** Register an explicit allowlisted read, diplomacy, strategic, or inspection action. */
  public register<TArgs = Record<string, unknown>>(actionType: string, handler: CivActionDefinition<TArgs> | CivActionHandler): void { if (this.handlers.has(actionType)) throw new Error(`Civ action already registered: ${actionType}`); this.handlers.set(actionType, handler as CivActionDefinition); }
  /** Expose only model-facing definitions as generic decision tools. */
  public modelDecisionDefinitions(): DecisionToolDefinition[] { return [...this.handlers.entries()].filter(([, handler]) => handler.modelFacing !== false && handler.category !== 'DEV_INSPECTION').map(([actionName, handler]) => ({ name: `environment_${actionName.replace(/[^a-zA-Z0-9_]/g, '_')}`, actionName, description: handler.description ?? `Execute the registered Civ action ${actionName}.`, inputSchema: handler.inputSchema ?? z.record(z.string(), z.unknown()) })); }
  /** Execute one action with structural actor binding and restart-safe operation identity. */
  public async invoke(binding: CivActorBinding, turn: number, actionType: string, args: Record<string, unknown>, operationId: string): Promise<CivActionAttempt> {
    if (!binding.active) throw new Error(`Civ binding for actor ${binding.actorId} is inactive`);
    if (!operationId.trim()) throw new Error('Civ operationId is required');
    if (containsActingPlayerId(args)) throw new Error('actingPlayerId is structurally bound and cannot be supplied');
    const handler = this.handlers.get(actionType); if (!handler) throw new Error(`Unknown Civ action: ${actionType}`); if (handler.category === 'DEV_INSPECTION') throw new Error('Developer inspection actions are not model-facing');
    const previous = await this.journal.get(operationId); if (previous) { if (previous.actorId !== binding.actorId || previous.gameId !== binding.gameId || previous.actionType !== actionType) throw new Error(`Civ operation ${operationId} belongs to a different actor, game, or action`); if (previous.state !== 'EXECUTING') return previous; return this.reconcileOrUnknown(previous, handler); }
    const now = new Date().toISOString(); const attempt: CivActionAttempt = { operationId, sessionId: binding.sessionId, actorId: binding.actorId, gameId: binding.gameId, playerId: binding.playerId, sourceTurn: turn, actionType, category: handler.category, normalizedArguments: { ...args }, state: 'REQUESTED', requestedAt: now };
    if (!await this.journal.insert(attempt)) { const existing = await this.journal.get(operationId); if (!existing) throw new Error(`Civ operation ${operationId} was concurrently inserted but cannot be read`); return existing; }
    await this.journal.update(operationId, { state: 'EXECUTING', executingAt: now });
    try {
      const parsed = handler.inputSchema ? handler.inputSchema.parse(args) : args;
      const result = await handler.execute(binding, parsed, operationId);
      return this.journal.update(operationId, { ...result, completedAt: new Date().toISOString() });
    } catch (error) {
      return this.journal.update(operationId, { state: 'FAILED', failureClass: 'execution-error', resultSummary: error instanceof Error ? error.message : 'Civ action failed', completedAt: new Date().toISOString() });
    }
  }
  /** Reconcile interrupted execution when a handler provides authoritative readback. */
  private async reconcileOrUnknown(attempt: CivActionAttempt, handler: CivActionDefinition): Promise<CivActionAttempt> { if (!handler.reconcile) return this.journal.update(attempt.operationId, { state: 'UNKNOWN', failureClass: 'restart-outcome-unknown', completedAt: new Date().toISOString() }); const result = await handler.reconcile(attempt).catch((error: unknown) => ({ state: 'UNKNOWN' as const, failureClass: 'reconcile-error', resultSummary: error instanceof Error ? error.message : 'Civ reconciliation failed' })); return this.journal.update(attempt.operationId, { ...result, completedAt: new Date().toISOString() }); }
  /** Recover all interrupted operations for a session without blindly replaying them. */
  public async recover(sessionId: string): Promise<CivActionAttempt[]> { const attempts = await this.journal.listExecuting(sessionId); const recovered: CivActionAttempt[] = []; for (const attempt of attempts) { const handler = this.handlers.get(attempt.actionType); if (handler) recovered.push(await this.reconcileOrUnknown(attempt, handler)); } return recovered; }
  /** Inspect a durable operation asynchronously. */
  public async get(operationId: string): Promise<CivActionAttempt | undefined> { return this.journal.get(operationId); }
}

/** Reject acting-seat spoofing anywhere in a model-provided argument object. */
function containsActingPlayerId(value: unknown): boolean { if (Array.isArray(value)) return value.some((item) => containsActingPlayerId(item)); if (!value || typeof value !== 'object') return false; return Object.entries(value).some(([key, child]) => key.toLowerCase() === 'actingplayerid' || containsActingPlayerId(child)); }
