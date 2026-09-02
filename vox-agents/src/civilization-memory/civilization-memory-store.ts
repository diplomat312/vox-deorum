/**
 * SQLite-backed civilization continuity store.
 *
 * This class persists factual chronicle entries and model-authored plaintext memory. It intentionally
 * does not infer relationships, promises, importance, or event meaning.
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type {
  AppendChronicleInput,
  CivilizationChronicleEntry,
  CivilizationEvidenceRef,
  CivilizationMemoryScope,
  CivilizationMemorySnapshot,
  CivilizationOutlook,
  ChronicleCompactionRange,
  LongTermChronicle,
} from './types.js';
import {
  RECENT_CHRONICLE_HARD_TOKEN_LIMIT,
  RECENT_CHRONICLE_SOFT_TOKEN_LIMIT,
  RECENT_CHRONICLE_TARGET_TOKEN_LIMIT,
  MAX_OUTLOOK_CHARACTERS,
  civilizationMemoryTokenCharacters,
  estimateCivilizationMemoryTokens,
} from './civilization-memory-budget.js';

type Sqlite = InstanceType<typeof Database>;

/** A normal optimistic-concurrency conflict that the active civilization wake can reconcile. */
export class CivilizationOutlookConflictError extends Error {
  public readonly latest?: CivilizationOutlook;

  /** Create a conflict carrying the latest plaintext state without exposing storage metadata. */
  public constructor(latest?: CivilizationOutlook) {
    super('Your Current Outlook changed during this wake.');
    this.name = 'CivilizationOutlookConflictError';
    this.latest = latest;
  }
}

/** Parse a JSON evidence value without allowing malformed historical rows to break a wake. */
function parseEvidence(value: string | null): CivilizationEvidenceRef | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as CivilizationEvidenceRef;
    return parsed && typeof parsed.kind === 'string' && typeof parsed.id === 'string' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Parse a participant list while tolerating old or malformed rows. */
function parseParticipants(value: string | null): number[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as number[];
    return Array.isArray(parsed) ? parsed.filter((item): item is number => Number.isInteger(item)) : undefined;
  } catch {
    return undefined;
  }
}

/** Convert a database row to a chronicle entry. */
function chronicleFromRow(row: Record<string, unknown>): CivilizationChronicleEntry {
  const evidenceRef = parseEvidence(typeof row.evidenceJson === 'string' ? row.evidenceJson : null);
  const participantPlayerIds = parseParticipants(typeof row.participantPlayerIdsJson === 'string' ? row.participantPlayerIdsJson : null);
  return {
    id: String(row.id),
    gameId: String(row.gameId),
    ownerPlayerId: Number(row.ownerPlayerId),
    sequence: Number(row.sequence),
    turn: Number(row.turn),
    timestamp: Number(row.timestamp),
    kind: row.kind as CivilizationChronicleEntry['kind'],
    text: String(row.text),
    ...(evidenceRef ? { evidenceRef } : {}),
    ...(row.dedupeKey === null ? {} : { dedupeKey: String(row.dedupeKey) }),
    ...(row.scope === null ? {} : { scope: row.scope as CivilizationChronicleEntry['scope'] }),
    ...(participantPlayerIds ? { participantPlayerIds } : {}),
  };
}

/** SQLite persistence for one game's civilization-owned continuity. */
export class CivilizationMemoryStore {
  private readonly sqlite: Sqlite;
  private readonly registeredOwners = new Set<number>();

  /** Open the store and create only the continuity tables needed by the new architecture. */
  public constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.sqlite = new Database(dbPath);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('synchronous = NORMAL');
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS civilizationOutlookRevisions (
        gameId TEXT NOT NULL, ownerPlayerId INTEGER NOT NULL, revision INTEGER NOT NULL,
        turn INTEGER NOT NULL, wakeTraceId TEXT, text TEXT NOT NULL, createdAt INTEGER NOT NULL,
        PRIMARY KEY (gameId, ownerPlayerId, revision)
      );
      CREATE TABLE IF NOT EXISTS civilizationChronicleEntries (
        id TEXT PRIMARY KEY, gameId TEXT NOT NULL, ownerPlayerId INTEGER NOT NULL,
        sequence INTEGER NOT NULL, turn INTEGER NOT NULL, timestamp INTEGER NOT NULL,
        kind TEXT NOT NULL, text TEXT NOT NULL, evidenceJson TEXT, dedupeKey TEXT,
        scope TEXT, participantPlayerIdsJson TEXT,
        UNIQUE (gameId, ownerPlayerId, dedupeKey)
      );
      CREATE TABLE IF NOT EXISTS civilizationLongTermRevisions (
        gameId TEXT NOT NULL, ownerPlayerId INTEGER NOT NULL, revision INTEGER NOT NULL,
        text TEXT NOT NULL, compactedThroughSequence INTEGER NOT NULL, updatedTurn INTEGER NOT NULL,
        wakeTraceId TEXT, createdAt INTEGER NOT NULL,
        PRIMARY KEY (gameId, ownerPlayerId, revision)
      );
      CREATE TABLE IF NOT EXISTS civilizationMemoryState (
        gameId TEXT NOT NULL, ownerPlayerId INTEGER NOT NULL, nextSequence INTEGER NOT NULL,
        outlookRevision INTEGER NOT NULL, longTermRevision INTEGER NOT NULL,
        compactedThroughSequence INTEGER NOT NULL, maintenanceRequired INTEGER NOT NULL,
        PRIMARY KEY (gameId, ownerPlayerId)
      );
      CREATE TABLE IF NOT EXISTS civilizationMemoryMutations (
        operationKey TEXT PRIMARY KEY, gameId TEXT NOT NULL, ownerPlayerId INTEGER NOT NULL,
        resultJson TEXT NOT NULL, createdAt INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS civilizationChronicleScopeIndex
        ON civilizationChronicleEntries(gameId, ownerPlayerId, sequence);
    `);
  }

  /** Close the database when its owning game session ends. */
  public close(): void {
    if (this.sqlite.open) this.sqlite.close();
  }

  /** Register a live unified seat as an owner before any shared facts are ingested. */
  public registerOwner(playerId: number): void {
    this.registeredOwners.add(playerId);
  }

  /** Check whether a seat is a live unified civilization owner in this session. */
  public isRegisteredOwner(playerId: number): boolean {
    return this.registeredOwners.has(playerId);
  }

  /** Ensure state exists for a civilization before reading or mutating it. */
  private ensureState(scope: CivilizationMemoryScope): void {
    this.sqlite.prepare(`
      INSERT OR IGNORE INTO civilizationMemoryState
      (gameId, ownerPlayerId, nextSequence, outlookRevision, longTermRevision, compactedThroughSequence, maintenanceRequired)
      VALUES (?, ?, 1, 0, 0, 0, 0)
    `).run(scope.gameId, scope.ownerPlayerId);
  }

  /** Count all uncompacted raw Chronicle text without applying the prompt display window. */
  private getUncompactedChronicleTokens(scope: CivilizationMemoryScope): number {
    this.ensureState(scope);
    const state = this.sqlite.prepare(`SELECT compactedThroughSequence FROM civilizationMemoryState WHERE gameId = ? AND ownerPlayerId = ?`)
      .get(scope.gameId, scope.ownerPlayerId) as { compactedThroughSequence: number };
    const row = this.sqlite.prepare(`SELECT COALESCE(SUM(LENGTH(text)), 0) AS characters
      FROM civilizationChronicleEntries WHERE gameId = ? AND ownerPlayerId = ? AND sequence > ?`)
      .get(scope.gameId, scope.ownerPlayerId, state.compactedThroughSequence) as { characters: number };
    return Math.ceil(Number(row.characters ?? 0) / 4);
  }

  /** Reconcile the persisted flag with the authoritative uncompacted Chronicle size. */
  private refreshMaintenanceState(scope: CivilizationMemoryScope, tokenCount = this.getUncompactedChronicleTokens(scope)): number {
    this.sqlite.prepare(`UPDATE civilizationMemoryState SET maintenanceRequired = ? WHERE gameId = ? AND ownerPlayerId = ?`)
      .run(tokenCount > RECENT_CHRONICLE_SOFT_TOKEN_LIMIT ? 1 : 0, scope.gameId, scope.ownerPlayerId);
    return tokenCount;
  }

  /** Read the current outlook revision for a civilization. */
  public getOutlook(scope: CivilizationMemoryScope): CivilizationOutlook | undefined {
    this.ensureState(scope);
    const row = this.sqlite.prepare(`
      SELECT * FROM civilizationOutlookRevisions
      WHERE gameId = ? AND ownerPlayerId = ? ORDER BY revision DESC LIMIT 1
    `).get(scope.gameId, scope.ownerPlayerId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      gameId: String(row.gameId), ownerPlayerId: Number(row.ownerPlayerId), text: String(row.text),
      revision: Number(row.revision), createdTurn: Number(row.turn), updatedTurn: Number(row.turn),
      ...(row.wakeTraceId ? { updatedByWakeTraceId: String(row.wakeTraceId) } : {}),
    };
  }

  /** Read all self-authored Outlook revisions for developer inspection without exposing them to wakes. */
  public getOutlookRevisions(scope: CivilizationMemoryScope): CivilizationOutlook[] {
    this.ensureState(scope);
    const rows = this.sqlite.prepare(`SELECT * FROM civilizationOutlookRevisions
      WHERE gameId = ? AND ownerPlayerId = ? ORDER BY revision ASC`).all(scope.gameId, scope.ownerPlayerId) as Record<string, unknown>[];
    return rows.map(row => ({
      gameId: String(row.gameId), ownerPlayerId: Number(row.ownerPlayerId), text: String(row.text),
      revision: Number(row.revision), createdTurn: Number(row.turn), updatedTurn: Number(row.turn),
      ...(row.wakeTraceId ? { updatedByWakeTraceId: String(row.wakeTraceId) } : {}),
    }));
  }

  /** Persist a new self-authored outlook only if the caller still owns the observed revision. */
  public updateOutlook(scope: CivilizationMemoryScope, text: string, expectedRevision: number, operationKey: string): CivilizationOutlook {
    this.ensureState(scope);
    const normalizedText = text.trim();
    if (normalizedText.length === 0) throw new Error('Current Outlook cannot be empty.');
    if (normalizedText.length > MAX_OUTLOOK_CHARACTERS) throw new Error('Current Outlook is too long. Rewrite it more concisely.');
    const write = this.sqlite.transaction(() => {
      const existing = this.sqlite.prepare('SELECT resultJson FROM civilizationMemoryMutations WHERE operationKey = ?').get(operationKey) as { resultJson: string } | undefined;
      if (existing) return JSON.parse(existing.resultJson) as CivilizationOutlook;
      const current = this.sqlite.prepare(`SELECT outlookRevision FROM civilizationMemoryState WHERE gameId = ? AND ownerPlayerId = ?`).get(scope.gameId, scope.ownerPlayerId) as { outlookRevision: number };
      if (current.outlookRevision !== expectedRevision) {
        throw new CivilizationOutlookConflictError(this.getOutlook(scope));
      }
      const result: CivilizationOutlook = {
        gameId: scope.gameId, ownerPlayerId: scope.ownerPlayerId, text: normalizedText,
        revision: expectedRevision + 1, createdTurn: scope.turn, updatedTurn: scope.turn,
        ...(scope.wakeTraceId ? { updatedByWakeTraceId: scope.wakeTraceId } : {}),
      };
      this.sqlite.prepare(`INSERT INTO civilizationOutlookRevisions
        (gameId, ownerPlayerId, revision, turn, wakeTraceId, text, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(result.gameId, result.ownerPlayerId, result.revision, scope.turn, scope.wakeTraceId ?? null, result.text, Date.now());
      this.sqlite.prepare(`UPDATE civilizationMemoryState SET outlookRevision = ? WHERE gameId = ? AND ownerPlayerId = ?`)
        .run(result.revision, scope.gameId, scope.ownerPlayerId);
      this.sqlite.prepare(`INSERT INTO civilizationMemoryMutations (operationKey, gameId, ownerPlayerId, resultJson, createdAt) VALUES (?, ?, ?, ?, ?)`)
        .run(operationKey, scope.gameId, scope.ownerPlayerId, JSON.stringify(result), Date.now());
      return result;
    });
    return write();
  }

  /** Append one factual chronicle entry, returning the existing entry on a deterministic retry. */
  public appendChronicle(scope: CivilizationMemoryScope, input: AppendChronicleInput): CivilizationChronicleEntry {
    this.ensureState(scope);
    if (input.dedupeKey) {
      const existing = this.sqlite.prepare(`SELECT * FROM civilizationChronicleEntries WHERE gameId = ? AND ownerPlayerId = ? AND dedupeKey = ?`)
        .get(scope.gameId, scope.ownerPlayerId, input.dedupeKey) as Record<string, unknown> | undefined;
      if (existing) return chronicleFromRow(existing);
    }
    const state = this.sqlite.prepare(`SELECT nextSequence FROM civilizationMemoryState WHERE gameId = ? AND ownerPlayerId = ?`)
      .get(scope.gameId, scope.ownerPlayerId) as { nextSequence: number };
    const result: CivilizationChronicleEntry = {
      id: uuidv4(), gameId: scope.gameId, ownerPlayerId: scope.ownerPlayerId, sequence: state.nextSequence,
      turn: input.turn, timestamp: input.timestamp ?? Date.now(), kind: input.kind, text: input.text.trim(),
      ...(input.evidenceRef ? { evidenceRef: input.evidenceRef } : {}),
      ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
      ...(input.scope ? { scope: input.scope } : {}),
      ...(input.participantPlayerIds ? { participantPlayerIds: [...new Set(input.participantPlayerIds)] } : {}),
    };
    this.sqlite.transaction(() => {
      this.sqlite.prepare(`INSERT INTO civilizationChronicleEntries
        (id, gameId, ownerPlayerId, sequence, turn, timestamp, kind, text, evidenceJson, dedupeKey, scope, participantPlayerIdsJson)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(result.id, result.gameId, result.ownerPlayerId, result.sequence, result.turn, result.timestamp, result.kind,
          result.text, result.evidenceRef ? JSON.stringify(result.evidenceRef) : null, result.dedupeKey ?? null,
          result.scope ?? null, result.participantPlayerIds ? JSON.stringify(result.participantPlayerIds) : null);
      this.sqlite.prepare(`UPDATE civilizationMemoryState SET nextSequence = nextSequence + 1 WHERE gameId = ? AND ownerPlayerId = ?`)
        .run(scope.gameId, scope.ownerPlayerId);
      this.refreshMaintenanceState(scope);
    })();
    return result;
  }

  /** Read a chronological bounded window without interpreting its contents. */
  public getRecentChronicle(scope: CivilizationMemoryScope, maxCharacters = civilizationMemoryTokenCharacters(RECENT_CHRONICLE_HARD_TOKEN_LIMIT)): CivilizationChronicleEntry[] {
    this.ensureState(scope);
    const state = this.sqlite.prepare(`SELECT compactedThroughSequence FROM civilizationMemoryState WHERE gameId = ? AND ownerPlayerId = ?`)
      .get(scope.gameId, scope.ownerPlayerId) as { compactedThroughSequence: number };
    const rows = this.sqlite.prepare(`SELECT * FROM civilizationChronicleEntries
      WHERE gameId = ? AND ownerPlayerId = ? AND sequence > ? ORDER BY sequence DESC`).all(scope.gameId, scope.ownerPlayerId, state.compactedThroughSequence) as Record<string, unknown>[];
    const selected: CivilizationChronicleEntry[] = [];
    let characters = 0;
    for (const row of rows) {
      const entry = chronicleFromRow(row);
      if (selected.length > 0 && characters + entry.text.length > maxCharacters) break;
      selected.push(entry);
      characters += entry.text.length;
    }
    return selected.reverse();
  }

  /** Read every factual entry, including compacted raw evidence retained underneath memory. */
  public getAllChronicle(scope: CivilizationMemoryScope): CivilizationChronicleEntry[] {
    this.ensureState(scope);
    const rows = this.sqlite.prepare(`SELECT * FROM civilizationChronicleEntries
      WHERE gameId = ? AND ownerPlayerId = ? ORDER BY sequence ASC`).all(scope.gameId, scope.ownerPlayerId) as Record<string, unknown>[];
    return rows.map(chronicleFromRow);
  }

  /** Read the latest long-term chronicle revision, if compaction has completed. */
  public getLongTerm(scope: CivilizationMemoryScope): LongTermChronicle | undefined {
    this.ensureState(scope);
    const row = this.sqlite.prepare(`SELECT * FROM civilizationLongTermRevisions
      WHERE gameId = ? AND ownerPlayerId = ? ORDER BY revision DESC LIMIT 1`).get(scope.gameId, scope.ownerPlayerId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      gameId: String(row.gameId), ownerPlayerId: Number(row.ownerPlayerId), text: String(row.text),
      compactedThroughSequence: Number(row.compactedThroughSequence), revision: Number(row.revision),
      updatedTurn: Number(row.updatedTurn), ...(row.wakeTraceId ? { wakeTraceId: String(row.wakeTraceId) } : {}),
    };
  }

  /** Return bounded continuity and the deterministic maintenance flag for a wake. */
  public getSnapshot(scope: CivilizationMemoryScope, maxCharacters = civilizationMemoryTokenCharacters(RECENT_CHRONICLE_HARD_TOKEN_LIMIT)): CivilizationMemorySnapshot {
    this.ensureState(scope);
    const uncompactedChronicleTokenCount = this.refreshMaintenanceState(scope);
    const recentChronicle = this.getRecentChronicle(scope, maxCharacters);
    const recentChronicleTokenCount = recentChronicle.reduce((total, entry) => total + estimateCivilizationMemoryTokens(entry.text), 0);
    const recentChronicleTruncated = recentChronicleTokenCount < uncompactedChronicleTokenCount;
    return {
      ...(this.getOutlook(scope) ? { outlook: this.getOutlook(scope) } : {}),
      ...(this.getLongTerm(scope) ? { longTerm: this.getLongTerm(scope) } : {}),
      recentChronicle,
      recentChronicleTokenCount,
      uncompactedChronicleTokenCount,
      recentChronicleTruncated,
      maintenanceRequired: uncompactedChronicleTokenCount > RECENT_CHRONICLE_SOFT_TOKEN_LIMIT,
    };
  }

  /** Return whether uncompacted factual history has crossed the maintenance soft limit. */
  public needsMaintenance(scope: CivilizationMemoryScope): boolean {
    return this.refreshMaintenanceState(scope) > RECENT_CHRONICLE_SOFT_TOKEN_LIMIT;
  }

  /** Mark maintenance as required without changing any model-authored content. */
  public markMaintenanceRequired(scope: CivilizationMemoryScope): void {
    this.ensureState(scope);
    this.refreshMaintenanceState(scope);
  }

  /** Select the oldest whole entries needed to return recent history near the target budget. */
  public selectCompactionRange(
    scope: CivilizationMemoryScope,
    options: { targetRemainingTokens?: number; maxEntries?: number } | number = {},
  ): ChronicleCompactionRange | undefined {
    this.ensureState(scope);
    const normalizedOptions = typeof options === 'number' ? { maxEntries: options } : options;
    const targetRemainingTokens = normalizedOptions.targetRemainingTokens ?? RECENT_CHRONICLE_TARGET_TOKEN_LIMIT;
    const maxEntries = normalizedOptions.maxEntries ?? 1000;
    const currentTokens = this.getUncompactedChronicleTokens(scope);
    if (currentTokens <= RECENT_CHRONICLE_SOFT_TOKEN_LIMIT) return undefined;
    const state = this.sqlite.prepare(`SELECT compactedThroughSequence, longTermRevision FROM civilizationMemoryState WHERE gameId = ? AND ownerPlayerId = ?`)
      .get(scope.gameId, scope.ownerPlayerId) as { compactedThroughSequence: number; longTermRevision: number };
    const rows = this.sqlite.prepare(`SELECT * FROM civilizationChronicleEntries
      WHERE gameId = ? AND ownerPlayerId = ? AND sequence > ? ORDER BY sequence ASC`)
      .all(scope.gameId, scope.ownerPlayerId, state.compactedThroughSequence) as Record<string, unknown>[];
    if (rows.length === 0) return undefined;
    const allEntries = rows.map(chronicleFromRow);
    const entries: CivilizationChronicleEntry[] = [];
    let remainingTokens = currentTokens;
    for (const entry of allEntries) {
      if (entries.length >= maxEntries || remainingTokens <= targetRemainingTokens) break;
      entries.push(entry);
      remainingTokens -= estimateCivilizationMemoryTokens(entry.text);
    }
    if (entries.length === 0) return undefined;
    const throughSequence = entries[entries.length - 1]!.sequence;
    return {
      fromSequence: entries[0]!.sequence,
      throughSequence,
      priorLongTermRevision: state.longTermRevision,
      operationKey: `${scope.gameId}:${scope.ownerPlayerId}:${entries[0]!.sequence}:${throughSequence}:${state.longTermRevision}`,
      entries,
    };
  }

  /** Atomically commit a successful same-mind compaction and advance the checkpoint. */
  public commitCompaction(scope: CivilizationMemoryScope, range: ChronicleCompactionRange, text: string): LongTermChronicle {
    this.ensureState(scope);
    const existing = this.sqlite.prepare(`SELECT resultJson FROM civilizationMemoryMutations WHERE operationKey = ?`).get(range.operationKey) as { resultJson: string } | undefined;
    if (existing) return JSON.parse(existing.resultJson) as LongTermChronicle;
    const state = this.sqlite.prepare(`SELECT compactedThroughSequence, longTermRevision FROM civilizationMemoryState WHERE gameId = ? AND ownerPlayerId = ?`)
      .get(scope.gameId, scope.ownerPlayerId) as { compactedThroughSequence: number; longTermRevision: number };
    if (state.compactedThroughSequence >= range.throughSequence || state.longTermRevision !== range.priorLongTermRevision) {
      throw new Error('Memory maintenance range is stale and must be selected again.');
    }
    const result: LongTermChronicle = {
      gameId: scope.gameId, ownerPlayerId: scope.ownerPlayerId, text: text.trim(),
      compactedThroughSequence: range.throughSequence, revision: state.longTermRevision + 1,
      updatedTurn: scope.turn, ...(scope.wakeTraceId ? { wakeTraceId: scope.wakeTraceId } : {}),
    };
    this.sqlite.transaction(() => {
      this.sqlite.prepare(`INSERT INTO civilizationLongTermRevisions
        (gameId, ownerPlayerId, revision, text, compactedThroughSequence, updatedTurn, wakeTraceId, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(result.gameId, result.ownerPlayerId, result.revision, result.text, result.compactedThroughSequence,
          result.updatedTurn, scope.wakeTraceId ?? null, Date.now());
      this.sqlite.prepare(`UPDATE civilizationMemoryState SET longTermRevision = ?, compactedThroughSequence = ?
        WHERE gameId = ? AND ownerPlayerId = ?`)
        .run(result.revision, result.compactedThroughSequence, scope.gameId, scope.ownerPlayerId);
      this.refreshMaintenanceState(scope);
      this.sqlite.prepare(`INSERT INTO civilizationMemoryMutations (operationKey, gameId, ownerPlayerId, resultJson, createdAt) VALUES (?, ?, ?, ?, ?)`)
        .run(range.operationKey, scope.gameId, scope.ownerPlayerId, JSON.stringify(result), Date.now());
    })();
    return result;
  }
}
