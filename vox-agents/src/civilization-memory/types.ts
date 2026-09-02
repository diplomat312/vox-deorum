/**
 * Durable, civilization-owned continuity for the unified civilization mind.
 *
 * The backend stores facts and model-authored prose. It does not classify political meaning.
 */

/** The factual scope of a chronicle entry. */
export type CivilizationChronicleScope = 'self' | 'private' | 'group' | 'public' | 'game';

/** The factual source category for a chronicle entry. */
export type CivilizationChronicleKind =
  | 'game-event'
  | 'private-message'
  | 'group-message'
  | 'public-message'
  | 'deal'
  | 'strategy-action'
  | 'political-action'
  | 'self-note';

/** Internal provenance for a factual chronicle entry. */
export interface CivilizationEvidenceRef {
  kind: string;
  id: string;
}

/** The current self-authored political outlook of one civilization. */
export interface CivilizationOutlook {
  gameId: string;
  ownerPlayerId: number;
  text: string;
  revision: number;
  createdTurn: number;
  updatedTurn: number;
  updatedByWakeTraceId?: string;
}

/** One append-only factual event experienced by a civilization. */
export interface CivilizationChronicleEntry {
  id: string;
  gameId: string;
  ownerPlayerId: number;
  sequence: number;
  turn: number;
  timestamp: number;
  kind: CivilizationChronicleKind;
  text: string;
  evidenceRef?: CivilizationEvidenceRef;
  dedupeKey?: string;
  scope?: CivilizationChronicleScope;
  participantPlayerIds?: number[];
}

/** The model-authored compression of older factual chronicle entries. */
export interface LongTermChronicle {
  gameId: string;
  ownerPlayerId: number;
  text: string;
  compactedThroughSequence: number;
  revision: number;
  updatedTurn: number;
  wakeTraceId?: string;
}

/** Bounded continuity supplied to any authoritative unified wake. */
export interface CivilizationMemorySnapshot {
  outlook?: CivilizationOutlook;
  longTerm?: LongTermChronicle;
  recentChronicle: CivilizationChronicleEntry[];
  recentChronicleTokenCount: number;
  /** Total estimated tokens before the prompt-size window is applied. */
  uncompactedChronicleTokenCount?: number;
  /** True when the hard-limit prompt window omitted oldest raw entries. */
  recentChronicleTruncated?: boolean;
  maintenanceRequired: boolean;
}

/** Scope supplied by the runtime, never authored by the model. */
export interface CivilizationMemoryScope {
  gameId: string;
  ownerPlayerId: number;
  turn: number;
  wakeTraceId?: string;
}

/** Input for an append-only factual chronicle operation. */
export interface AppendChronicleInput {
  turn: number;
  kind: CivilizationChronicleKind;
  text: string;
  evidenceRef?: CivilizationEvidenceRef;
  dedupeKey?: string;
  scope?: CivilizationChronicleScope;
  participantPlayerIds?: number[];
  timestamp?: number;
}

/** Result of claiming a deterministic compaction range. */
export interface ChronicleCompactionRange {
  fromSequence: number;
  throughSequence: number;
  priorLongTermRevision: number;
  operationKey: string;
  entries: CivilizationChronicleEntry[];
}
