/**
 * @module political-memory/political-memory-store
 *
 * Small SQLite-backed store for semantic political memory. The store owns persistence and retry
 * safety while the unified adapters remain responsible for deciding what is politically meaningful.
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type {
  AdjustRelationshipInput,
  CreateGoalInput,
  CreateProjectInput,
  PoliticalBelief,
  PoliticalCommitment,
  PoliticalEpisode,
  PoliticalEvidenceRef,
  PoliticalGoal,
  PoliticalMemoryScope,
  PoliticalMemorySnapshot,
  PoliticalProject,
  PoliticalRelationship,
  RecordCommitmentInput,
  RememberEpisodeInput,
  UpsertBeliefInput,
} from './types.js';

type Sqlite = InstanceType<typeof Database>;
type MutationResult = PoliticalGoal | PoliticalCommitment | PoliticalRelationship | PoliticalBelief | PoliticalEpisode | PoliticalProject;

const relationshipDelta: Record<AdjustRelationshipInput['magnitude'], number> = {
  slight: 5,
  moderate: 15,
  major: 30,
};

/** Serialize evidence references consistently for SQLite. */
function encodeEvidence(evidence: PoliticalEvidenceRef[]): string {
  return JSON.stringify(evidence);
}

/** Parse a stored evidence list while tolerating an old or malformed row. */
function decodeEvidence(value: string): PoliticalEvidenceRef[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as PoliticalEvidenceRef[] : [];
  } catch {
    return [];
  }
}

/** Clamp a subjective relationship value to the documented 0 through 100 range. */
function clampRelationship(value: number): number {
  return Math.max(0, Math.min(100, value));
}

/** Return active records before resolved records, then prefer recent and important entries. */
function statusRank(status: string): number {
  return status === 'active' ? 0 : 1;
}

/** Return a deterministic priority rank for bounded goal and project retrieval. */
function priorityRank(priority: string): number {
  return priority === 'critical' ? 0 : priority === 'high' ? 1 : priority === 'medium' ? 2 : 3;
}

/** Return a deterministic importance rank for episode retrieval. */
function importanceRank(importance: string): number {
  return importance === 'critical' ? 0 : importance === 'high' ? 1 : 2;
}

/** Durable SQLite store for one civilization's scoped political interpretations. */
export class PoliticalMemoryStore {
  private readonly sqlite: Sqlite;

  /** Open a persistent memory database and create its small explicit schema. */
  public constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.sqlite = new Database(dbPath);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('synchronous = NORMAL');
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS politicalGoals (
        id TEXT PRIMARY KEY, gameId TEXT NOT NULL, ownerPlayerId INTEGER NOT NULL,
        title TEXT NOT NULL, description TEXT, priority TEXT NOT NULL, status TEXT NOT NULL,
        createdTurn INTEGER NOT NULL, updatedTurn INTEGER NOT NULL, resolvedTurn INTEGER,
        rationale TEXT, evidenceJson TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS politicalCommitments (
        id TEXT PRIMARY KEY, gameId TEXT NOT NULL, ownerPlayerId INTEGER NOT NULL,
        partiesJson TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
        summary TEXT NOT NULL, terms TEXT, createdTurn INTEGER NOT NULL, dueTurn INTEGER,
        resolvedTurn INTEGER, visibility TEXT NOT NULL, evidenceJson TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS politicalRelationships (
        gameId TEXT NOT NULL, ownerPlayerId INTEGER NOT NULL, counterpartPlayerId INTEGER NOT NULL,
        trust INTEGER NOT NULL, grievance INTEGER NOT NULL, favor INTEGER NOT NULL, threat INTEGER NOT NULL,
        summary TEXT, updatedTurn INTEGER NOT NULL, evidenceJson TEXT NOT NULL,
        PRIMARY KEY (gameId, ownerPlayerId, counterpartPlayerId)
      );
      CREATE TABLE IF NOT EXISTS politicalBeliefs (
        id TEXT PRIMARY KEY, gameId TEXT NOT NULL, ownerPlayerId INTEGER NOT NULL,
        subject TEXT NOT NULL, claim TEXT NOT NULL, confidence TEXT NOT NULL, status TEXT NOT NULL,
        createdTurn INTEGER NOT NULL, updatedTurn INTEGER NOT NULL, evidenceJson TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS politicalEpisodes (
        id TEXT PRIMARY KEY, gameId TEXT NOT NULL, ownerPlayerId INTEGER NOT NULL,
        turn INTEGER NOT NULL, importance TEXT NOT NULL, summary TEXT NOT NULL,
        counterpartPlayerIdsJson TEXT NOT NULL, tagsJson TEXT NOT NULL, evidenceJson TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS politicalProjects (
        id TEXT PRIMARY KEY, gameId TEXT NOT NULL, ownerPlayerId INTEGER NOT NULL,
        title TEXT NOT NULL, description TEXT, counterpartPlayerIdsJson TEXT NOT NULL,
        status TEXT NOT NULL, priority TEXT NOT NULL, createdTurn INTEGER NOT NULL,
        updatedTurn INTEGER NOT NULL, resolvedTurn INTEGER, evidenceJson TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS politicalMemoryMutations (
        mutationId TEXT PRIMARY KEY, gameId TEXT NOT NULL, ownerPlayerId INTEGER NOT NULL,
        resultJson TEXT NOT NULL, createdAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS politicalGoalsScopeIndex ON politicalGoals(gameId, ownerPlayerId, status, updatedTurn);
      CREATE INDEX IF NOT EXISTS politicalCommitmentsScopeIndex ON politicalCommitments(gameId, ownerPlayerId, status, createdTurn);
      CREATE INDEX IF NOT EXISTS politicalBeliefsScopeIndex ON politicalBeliefs(gameId, ownerPlayerId, status, updatedTurn);
      CREATE INDEX IF NOT EXISTS politicalEpisodesScopeIndex ON politicalEpisodes(gameId, ownerPlayerId, turn);
      CREATE INDEX IF NOT EXISTS politicalProjectsScopeIndex ON politicalProjects(gameId, ownerPlayerId, status, updatedTurn);
    `);
  }

  /** Close the underlying database after all session contexts have stopped. */
  public close(): void {
    if (this.sqlite.open) this.sqlite.close();
  }

  /** Load an idempotent mutation result before attempting to apply it again. */
  private readMutation<T extends MutationResult>(scope: PoliticalMemoryScope, mutationId: string): T | undefined {
    const row = this.sqlite.prepare(
      'SELECT resultJson FROM politicalMemoryMutations WHERE mutationId = ? AND gameId = ? AND ownerPlayerId = ?'
    ).get(mutationId, scope.gameId, scope.ownerPlayerId) as { resultJson: string } | undefined;
    if (!row) return undefined;
    return JSON.parse(row.resultJson) as T;
  }

  /** Persist the result of a mutation under its stable retry key. */
  private writeMutation(scope: PoliticalMemoryScope, mutationId: string, result: MutationResult): void {
    this.sqlite.prepare(
      'INSERT INTO politicalMemoryMutations (mutationId, gameId, ownerPlayerId, resultJson, createdAt) VALUES (?, ?, ?, ?, ?)'
    ).run(mutationId, scope.gameId, scope.ownerPlayerId, JSON.stringify(result), new Date().toISOString());
  }

  /** Read a goal row into its public semantic shape. */
  private goalFromRow(row: Record<string, unknown>): PoliticalGoal {
    return {
      id: String(row.id), gameId: String(row.gameId), ownerPlayerId: Number(row.ownerPlayerId),
      title: String(row.title), ...(row.description ? { description: String(row.description) } : {}),
      priority: row.priority as PoliticalGoal['priority'], status: row.status as PoliticalGoal['status'],
      createdTurn: Number(row.createdTurn), updatedTurn: Number(row.updatedTurn),
      ...(row.resolvedTurn === null ? {} : { resolvedTurn: Number(row.resolvedTurn) }),
      ...(row.rationale ? { rationale: String(row.rationale) } : {}), evidence: decodeEvidence(String(row.evidenceJson)),
    };
  }

  /** Read a commitment row into its public semantic shape. */
  private commitmentFromRow(row: Record<string, unknown>): PoliticalCommitment {
    return {
      id: String(row.id), gameId: String(row.gameId), ownerPlayerId: Number(row.ownerPlayerId),
      parties: JSON.parse(String(row.partiesJson)) as number[], kind: row.kind as PoliticalCommitment['kind'],
      status: row.status as PoliticalCommitment['status'], summary: String(row.summary),
      ...(row.terms ? { terms: String(row.terms) } : {}), createdTurn: Number(row.createdTurn),
      ...(row.dueTurn === null ? {} : { dueTurn: Number(row.dueTurn) }),
      ...(row.resolvedTurn === null ? {} : { resolvedTurn: Number(row.resolvedTurn) }),
      visibility: row.visibility as PoliticalCommitment['visibility'], evidence: decodeEvidence(String(row.evidenceJson)),
    };
  }

  /** Read a relationship row into its public semantic shape. */
  private relationshipFromRow(row: Record<string, unknown>): PoliticalRelationship {
    return {
      gameId: String(row.gameId), ownerPlayerId: Number(row.ownerPlayerId), counterpartPlayerId: Number(row.counterpartPlayerId),
      trust: Number(row.trust), grievance: Number(row.grievance), favor: Number(row.favor), threat: Number(row.threat),
      ...(row.summary ? { summary: String(row.summary) } : {}), updatedTurn: Number(row.updatedTurn),
      evidence: decodeEvidence(String(row.evidenceJson)),
    };
  }

  /** Read a belief row into its public semantic shape. */
  private beliefFromRow(row: Record<string, unknown>): PoliticalBelief {
    return {
      id: String(row.id), gameId: String(row.gameId), ownerPlayerId: Number(row.ownerPlayerId), subject: String(row.subject),
      claim: String(row.claim), confidence: row.confidence as PoliticalBelief['confidence'], status: row.status as PoliticalBelief['status'],
      createdTurn: Number(row.createdTurn), updatedTurn: Number(row.updatedTurn), evidence: decodeEvidence(String(row.evidenceJson)),
    };
  }

  /** Read an episode row into its public semantic shape. */
  private episodeFromRow(row: Record<string, unknown>): PoliticalEpisode {
    return {
      id: String(row.id), gameId: String(row.gameId), ownerPlayerId: Number(row.ownerPlayerId), turn: Number(row.turn),
      importance: row.importance as PoliticalEpisode['importance'], summary: String(row.summary),
      counterpartPlayerIds: JSON.parse(String(row.counterpartPlayerIdsJson)) as number[],
      tags: JSON.parse(String(row.tagsJson)) as string[], evidence: decodeEvidence(String(row.evidenceJson)),
    };
  }

  /** Read a project row into its public semantic shape. */
  private projectFromRow(row: Record<string, unknown>): PoliticalProject {
    return {
      id: String(row.id), gameId: String(row.gameId), ownerPlayerId: Number(row.ownerPlayerId), title: String(row.title),
      ...(row.description ? { description: String(row.description) } : {}),
      counterpartPlayerIds: JSON.parse(String(row.counterpartPlayerIdsJson)) as number[],
      status: row.status as PoliticalProject['status'], priority: row.priority as PoliticalProject['priority'],
      createdTurn: Number(row.createdTurn), updatedTurn: Number(row.updatedTurn),
      ...(row.resolvedTurn === null ? {} : { resolvedTurn: Number(row.resolvedTurn) }), evidence: decodeEvidence(String(row.evidenceJson)),
    };
  }

  /** Create a durable goal exactly once for this owner and mutation key. */
  public createGoal(scope: PoliticalMemoryScope, input: CreateGoalInput, mutationId: string): PoliticalGoal {
    const existing = this.readMutation<PoliticalGoal>(scope, mutationId);
    if (existing) return existing;
    const result: PoliticalGoal = { id: uuidv4(), gameId: scope.gameId, ownerPlayerId: scope.ownerPlayerId, title: input.title, ...(input.description ? { description: input.description } : {}), priority: input.priority, status: 'active', createdTurn: scope.turn, updatedTurn: scope.turn, ...(input.rationale ? { rationale: input.rationale } : {}), evidence: input.evidence ?? [] };
    this.sqlite.transaction(() => {
      this.sqlite.prepare('INSERT INTO politicalGoals (id, gameId, ownerPlayerId, title, description, priority, status, createdTurn, updatedTurn, resolvedTurn, rationale, evidenceJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(result.id, result.gameId, result.ownerPlayerId, result.title, result.description ?? null, result.priority, result.status, result.createdTurn, result.updatedTurn, null, result.rationale ?? null, encodeEvidence(result.evidence));
      this.writeMutation(scope, mutationId, result);
    })();
    return result;
  }

  /** Resolve one goal owned by the active civilization without deleting its history. */
  public resolveGoal(scope: PoliticalMemoryScope, id: string, status: Exclude<PoliticalGoal['status'], 'active'>, mutationId: string): PoliticalGoal {
    const existing = this.readMutation<PoliticalGoal>(scope, mutationId);
    if (existing) return existing;
    const row = this.sqlite.prepare('SELECT * FROM politicalGoals WHERE id = ? AND gameId = ? AND ownerPlayerId = ?').get(id, scope.gameId, scope.ownerPlayerId) as Record<string, unknown> | undefined;
    if (!row) throw new Error('Political goal not found for this civilization.');
    if (row.status !== 'active') throw new Error('Political goal is already resolved.');
    const result = { ...this.goalFromRow(row), status, updatedTurn: scope.turn, resolvedTurn: scope.turn };
    this.sqlite.transaction(() => {
      this.sqlite.prepare('UPDATE politicalGoals SET status = ?, updatedTurn = ?, resolvedTurn = ? WHERE id = ? AND gameId = ? AND ownerPlayerId = ?').run(status, scope.turn, scope.turn, id, scope.gameId, scope.ownerPlayerId);
      this.writeMutation(scope, mutationId, result);
    })();
    return result;
  }

  /** Record a promise, threat, request, agreement, or obligation exactly once. */
  public recordCommitment(scope: PoliticalMemoryScope, input: RecordCommitmentInput, mutationId: string): PoliticalCommitment {
    const existing = this.readMutation<PoliticalCommitment>(scope, mutationId);
    if (existing) return existing;
    const result: PoliticalCommitment = { id: uuidv4(), gameId: scope.gameId, ownerPlayerId: scope.ownerPlayerId, parties: [...new Set(input.parties)], kind: input.kind, status: 'active', summary: input.summary, ...(input.terms ? { terms: input.terms } : {}), createdTurn: scope.turn, ...(input.dueTurn === undefined ? {} : { dueTurn: input.dueTurn }), visibility: input.visibility, evidence: input.evidence ?? [] };
    this.sqlite.transaction(() => {
      this.sqlite.prepare('INSERT INTO politicalCommitments (id, gameId, ownerPlayerId, partiesJson, kind, status, summary, terms, createdTurn, dueTurn, resolvedTurn, visibility, evidenceJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(result.id, result.gameId, result.ownerPlayerId, JSON.stringify(result.parties), result.kind, result.status, result.summary, result.terms ?? null, result.createdTurn, result.dueTurn ?? null, null, result.visibility, encodeEvidence(result.evidence));
      this.writeMutation(scope, mutationId, result);
    })();
    return result;
  }

  /** Move a commitment to a terminal historical state. */
  public resolveCommitment(scope: PoliticalMemoryScope, id: string, status: Exclude<PoliticalCommitment['status'], 'active'>, mutationId: string): PoliticalCommitment {
    const existing = this.readMutation<PoliticalCommitment>(scope, mutationId);
    if (existing) return existing;
    const row = this.sqlite.prepare('SELECT * FROM politicalCommitments WHERE id = ? AND gameId = ? AND ownerPlayerId = ?').get(id, scope.gameId, scope.ownerPlayerId) as Record<string, unknown> | undefined;
    if (!row) throw new Error('Political commitment not found for this civilization.');
    if (row.status !== 'active') throw new Error('Political commitment is already resolved.');
    const result = { ...this.commitmentFromRow(row), status, resolvedTurn: scope.turn };
    this.sqlite.transaction(() => {
      this.sqlite.prepare('UPDATE politicalCommitments SET status = ?, resolvedTurn = ? WHERE id = ? AND gameId = ? AND ownerPlayerId = ?').run(status, scope.turn, id, scope.gameId, scope.ownerPlayerId);
      this.writeMutation(scope, mutationId, result);
    })();
    return result;
  }

  /** Apply a small semantic relationship adjustment, never arbitrary model arithmetic. */
  public adjustRelationship(scope: PoliticalMemoryScope, input: AdjustRelationshipInput, mutationId: string): PoliticalRelationship {
    const existing = this.readMutation<PoliticalRelationship>(scope, mutationId);
    if (existing) return existing;
    const row = this.sqlite.prepare('SELECT * FROM politicalRelationships WHERE gameId = ? AND ownerPlayerId = ? AND counterpartPlayerId = ?').get(scope.gameId, scope.ownerPlayerId, input.counterpartPlayerId) as Record<string, unknown> | undefined;
    const current = row ? this.relationshipFromRow(row) : { gameId: scope.gameId, ownerPlayerId: scope.ownerPlayerId, counterpartPlayerId: input.counterpartPlayerId, trust: 50, grievance: 0, favor: 50, threat: 0, updatedTurn: scope.turn, evidence: [] } satisfies PoliticalRelationship;
    const delta = relationshipDelta[input.magnitude] * (input.direction === 'increase' ? 1 : -1);
    const result: PoliticalRelationship = { ...current, [input.dimension]: clampRelationship(current[input.dimension] + delta), summary: input.reason ?? current.summary, updatedTurn: scope.turn, evidence: [...current.evidence, ...(input.evidence ?? [])] };
    this.sqlite.transaction(() => {
      this.sqlite.prepare('INSERT INTO politicalRelationships (gameId, ownerPlayerId, counterpartPlayerId, trust, grievance, favor, threat, summary, updatedTurn, evidenceJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(gameId, ownerPlayerId, counterpartPlayerId) DO UPDATE SET trust = excluded.trust, grievance = excluded.grievance, favor = excluded.favor, threat = excluded.threat, summary = excluded.summary, updatedTurn = excluded.updatedTurn, evidenceJson = excluded.evidenceJson').run(result.gameId, result.ownerPlayerId, result.counterpartPlayerId, result.trust, result.grievance, result.favor, result.threat, result.summary ?? null, result.updatedTurn, encodeEvidence(result.evidence));
      this.writeMutation(scope, mutationId, result);
    })();
    return result;
  }

  /** Insert or update a subjective belief while preserving its civilization ownership. */
  public upsertBelief(scope: PoliticalMemoryScope, input: UpsertBeliefInput, mutationId: string): PoliticalBelief {
    const existing = this.readMutation<PoliticalBelief>(scope, mutationId);
    if (existing) return existing;
    const id = input.id ?? uuidv4();
    const old = this.sqlite.prepare('SELECT * FROM politicalBeliefs WHERE id = ? AND gameId = ? AND ownerPlayerId = ?').get(id, scope.gameId, scope.ownerPlayerId) as Record<string, unknown> | undefined;
    const foreign = this.sqlite.prepare('SELECT id FROM politicalBeliefs WHERE id = ?').get(id) as { id: string } | undefined;
    if (foreign && !old) throw new Error('Political belief belongs to another civilization.');
    const result: PoliticalBelief = { id, gameId: scope.gameId, ownerPlayerId: scope.ownerPlayerId, subject: input.subject, claim: input.claim, confidence: input.confidence, status: 'active', createdTurn: old ? Number(old.createdTurn) : scope.turn, updatedTurn: scope.turn, evidence: input.evidence ?? (old ? decodeEvidence(String(old.evidenceJson)) : []) };
    this.sqlite.transaction(() => {
      this.sqlite.prepare('INSERT INTO politicalBeliefs (id, gameId, ownerPlayerId, subject, claim, confidence, status, createdTurn, updatedTurn, evidenceJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET subject = excluded.subject, claim = excluded.claim, confidence = excluded.confidence, status = excluded.status, updatedTurn = excluded.updatedTurn, evidenceJson = excluded.evidenceJson').run(result.id, result.gameId, result.ownerPlayerId, result.subject, result.claim, result.confidence, result.status, result.createdTurn, result.updatedTurn, encodeEvidence(result.evidence));
      this.writeMutation(scope, mutationId, result);
    })();
    return result;
  }

  /** Resolve a belief without converting it into an authoritative game fact. */
  public resolveBelief(scope: PoliticalMemoryScope, id: string, status: Exclude<PoliticalBelief['status'], 'active'>, mutationId: string): PoliticalBelief {
    const existing = this.readMutation<PoliticalBelief>(scope, mutationId);
    if (existing) return existing;
    const row = this.sqlite.prepare('SELECT * FROM politicalBeliefs WHERE id = ? AND gameId = ? AND ownerPlayerId = ?').get(id, scope.gameId, scope.ownerPlayerId) as Record<string, unknown> | undefined;
    if (!row) throw new Error('Political belief not found for this civilization.');
    if (row.status !== 'active') throw new Error('Political belief is already resolved.');
    const result = { ...this.beliefFromRow(row), status, updatedTurn: scope.turn };
    this.sqlite.transaction(() => {
      this.sqlite.prepare('UPDATE politicalBeliefs SET status = ?, updatedTurn = ? WHERE id = ? AND gameId = ? AND ownerPlayerId = ?').run(status, scope.turn, id, scope.gameId, scope.ownerPlayerId);
      this.writeMutation(scope, mutationId, result);
    })();
    return result;
  }

  /** Remember one sparse politically meaningful episode exactly once. */
  public rememberEpisode(scope: PoliticalMemoryScope, input: RememberEpisodeInput, mutationId: string): PoliticalEpisode {
    const existing = this.readMutation<PoliticalEpisode>(scope, mutationId);
    if (existing) return existing;
    const result: PoliticalEpisode = { id: uuidv4(), gameId: scope.gameId, ownerPlayerId: scope.ownerPlayerId, turn: input.turn ?? scope.turn, importance: input.importance, summary: input.summary, counterpartPlayerIds: [...new Set(input.counterpartPlayerIds ?? [])], tags: [...new Set(input.tags ?? [])], evidence: input.evidence ?? [] };
    this.sqlite.transaction(() => {
      this.sqlite.prepare('INSERT INTO politicalEpisodes (id, gameId, ownerPlayerId, turn, importance, summary, counterpartPlayerIdsJson, tagsJson, evidenceJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(result.id, result.gameId, result.ownerPlayerId, result.turn, result.importance, result.summary, JSON.stringify(result.counterpartPlayerIds), JSON.stringify(result.tags), encodeEvidence(result.evidence));
      this.writeMutation(scope, mutationId, result);
    })();
    return result;
  }

  /** Create a durable multi-turn political project exactly once. */
  public createProject(scope: PoliticalMemoryScope, input: CreateProjectInput, mutationId: string): PoliticalProject {
    const existing = this.readMutation<PoliticalProject>(scope, mutationId);
    if (existing) return existing;
    const result: PoliticalProject = { id: uuidv4(), gameId: scope.gameId, ownerPlayerId: scope.ownerPlayerId, title: input.title, ...(input.description ? { description: input.description } : {}), counterpartPlayerIds: [...new Set(input.counterpartPlayerIds ?? [])], status: 'active', priority: input.priority, createdTurn: scope.turn, updatedTurn: scope.turn, evidence: input.evidence ?? [] };
    this.sqlite.transaction(() => {
      this.sqlite.prepare('INSERT INTO politicalProjects (id, gameId, ownerPlayerId, title, description, counterpartPlayerIdsJson, status, priority, createdTurn, updatedTurn, resolvedTurn, evidenceJson) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(result.id, result.gameId, result.ownerPlayerId, result.title, result.description ?? null, JSON.stringify(result.counterpartPlayerIds), result.status, result.priority, result.createdTurn, result.updatedTurn, null, encodeEvidence(result.evidence));
      this.writeMutation(scope, mutationId, result);
    })();
    return result;
  }

  /** Resolve a political project while retaining its historical outcome. */
  public resolveProject(scope: PoliticalMemoryScope, id: string, status: Exclude<PoliticalProject['status'], 'active'>, mutationId: string): PoliticalProject {
    const existing = this.readMutation<PoliticalProject>(scope, mutationId);
    if (existing) return existing;
    const row = this.sqlite.prepare('SELECT * FROM politicalProjects WHERE id = ? AND gameId = ? AND ownerPlayerId = ?').get(id, scope.gameId, scope.ownerPlayerId) as Record<string, unknown> | undefined;
    if (!row) throw new Error('Political project not found for this civilization.');
    if (row.status !== 'active') throw new Error('Political project is already resolved.');
    const result = { ...this.projectFromRow(row), status, updatedTurn: scope.turn, resolvedTurn: scope.turn };
    this.sqlite.transaction(() => {
      this.sqlite.prepare('UPDATE politicalProjects SET status = ?, updatedTurn = ?, resolvedTurn = ? WHERE id = ? AND gameId = ? AND ownerPlayerId = ?').run(status, scope.turn, scope.turn, id, scope.gameId, scope.ownerPlayerId);
      this.writeMutation(scope, mutationId, result);
    })();
    return result;
  }

  /** Load a bounded civilization-wide or counterpart-focused memory snapshot. */
  public getRelevantMemory(scope: PoliticalMemoryScope, counterpartPlayerId?: number): PoliticalMemorySnapshot {
    const goals = (this.sqlite.prepare('SELECT * FROM politicalGoals WHERE gameId = ? AND ownerPlayerId = ?').all(scope.gameId, scope.ownerPlayerId) as Array<Record<string, unknown>>).map(row => this.goalFromRow(row)).sort((a, b) => statusRank(a.status) - statusRank(b.status) || priorityRank(a.priority) - priorityRank(b.priority) || b.updatedTurn - a.updatedTurn).slice(0, 8);
    const commitments = (this.sqlite.prepare('SELECT * FROM politicalCommitments WHERE gameId = ? AND ownerPlayerId = ?').all(scope.gameId, scope.ownerPlayerId) as Array<Record<string, unknown>>).map(row => this.commitmentFromRow(row)).filter(item => counterpartPlayerId === undefined || item.parties.includes(counterpartPlayerId)).sort((a, b) => statusRank(a.status) - statusRank(b.status) || b.createdTurn - a.createdTurn).slice(0, 12);
    const relationships = (this.sqlite.prepare('SELECT * FROM politicalRelationships WHERE gameId = ? AND ownerPlayerId = ?').all(scope.gameId, scope.ownerPlayerId) as Array<Record<string, unknown>>).map(row => this.relationshipFromRow(row)).sort((a, b) => (a.counterpartPlayerId === counterpartPlayerId ? -1 : 0) - (b.counterpartPlayerId === counterpartPlayerId ? -1 : 0) || b.updatedTurn - a.updatedTurn).slice(0, counterpartPlayerId === undefined ? 8 : 4);
    const beliefs = (this.sqlite.prepare('SELECT * FROM politicalBeliefs WHERE gameId = ? AND ownerPlayerId = ?').all(scope.gameId, scope.ownerPlayerId) as Array<Record<string, unknown>>).map(row => this.beliefFromRow(row)).filter(item => counterpartPlayerId === undefined || item.subject.includes(String(counterpartPlayerId)) || item.claim.includes(String(counterpartPlayerId))).sort((a, b) => statusRank(a.status) - statusRank(b.status) || b.updatedTurn - a.updatedTurn).slice(0, 8);
    const episodes = (this.sqlite.prepare('SELECT * FROM politicalEpisodes WHERE gameId = ? AND ownerPlayerId = ?').all(scope.gameId, scope.ownerPlayerId) as Array<Record<string, unknown>>).map(row => this.episodeFromRow(row)).filter(item => counterpartPlayerId === undefined || item.counterpartPlayerIds.includes(counterpartPlayerId)).sort((a, b) => importanceRank(a.importance) - importanceRank(b.importance) || b.turn - a.turn).slice(0, 8);
    const projects = (this.sqlite.prepare('SELECT * FROM politicalProjects WHERE gameId = ? AND ownerPlayerId = ?').all(scope.gameId, scope.ownerPlayerId) as Array<Record<string, unknown>>).map(row => this.projectFromRow(row)).filter(item => counterpartPlayerId === undefined || item.counterpartPlayerIds.includes(counterpartPlayerId)).sort((a, b) => statusRank(a.status) - statusRank(b.status) || priorityRank(a.priority) - priorityRank(b.priority) || b.updatedTurn - a.updatedTurn).slice(0, 6);
    return { goals, commitments, relationships, beliefs, episodes, projects };
  }

  /** Return the full bounded snapshot for API and inspector views. */
  public getSnapshot(gameId: string, ownerPlayerId: number, turn: number): PoliticalMemorySnapshot {
    return this.getRelevantMemory({ gameId, ownerPlayerId, turn });
  }
}
