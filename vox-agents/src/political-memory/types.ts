/**
 * @module political-memory/types
 *
 * Durable, civilization-owned political meaning. These records are interpretations of raw game
 * and diplomatic evidence, not replacements for authoritative game state.
 */

/** Reference to the raw evidence that motivated a semantic memory record. */
export type PoliticalEvidenceRef =
  | { kind: 'transcript'; id: string }
  | { kind: 'deal'; id: string }
  | { kind: 'game-event'; id: string }
  | { kind: 'wake'; traceId: string };

/** Shared scope for every civilization-owned memory operation. */
export interface PoliticalMemoryScope {
  gameId: string;
  ownerPlayerId: number;
  turn: number;
}

/** Persistent strategic or political intention. */
export interface PoliticalGoal {
  id: string;
  gameId: string;
  ownerPlayerId: number;
  title: string;
  description?: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'active' | 'completed' | 'abandoned';
  createdTurn: number;
  updatedTurn: number;
  resolvedTurn?: number;
  rationale?: string;
  evidence: PoliticalEvidenceRef[];
}

/** Promise, threat, request, agreement, or formal obligation owned by one civilization. */
export interface PoliticalCommitment {
  id: string;
  gameId: string;
  ownerPlayerId: number;
  parties: number[];
  kind: 'promise' | 'conditional-promise' | 'threat' | 'request' | 'informal-agreement' | 'deal-obligation';
  status: 'active' | 'fulfilled' | 'broken' | 'expired' | 'withdrawn' | 'disputed';
  summary: string;
  terms?: string;
  createdTurn: number;
  dueTurn?: number;
  resolvedTurn?: number;
  visibility: 'private' | 'public';
  evidence: PoliticalEvidenceRef[];
}

/** Subjective relationship assessment, separate from Civ engine diplomacy values. */
export interface PoliticalRelationship {
  gameId: string;
  ownerPlayerId: number;
  counterpartPlayerId: number;
  trust: number;
  grievance: number;
  favor: number;
  threat: number;
  summary?: string;
  updatedTurn: number;
  evidence: PoliticalEvidenceRef[];
}

/** Uncertain subjective belief that must not overwrite authoritative game facts. */
export interface PoliticalBelief {
  id: string;
  gameId: string;
  ownerPlayerId: number;
  subject: string;
  claim: string;
  confidence: 'low' | 'medium' | 'high';
  status: 'active' | 'superseded' | 'disconfirmed';
  createdTurn: number;
  updatedTurn: number;
  evidence: PoliticalEvidenceRef[];
}

/** Sparse politically meaningful episode retained for long-horizon continuity. */
export interface PoliticalEpisode {
  id: string;
  gameId: string;
  ownerPlayerId: number;
  turn: number;
  importance: 'medium' | 'high' | 'critical';
  summary: string;
  counterpartPlayerIds: number[];
  tags: string[];
  evidence: PoliticalEvidenceRef[];
}

/** Multi-turn diplomatic undertaking. */
export interface PoliticalProject {
  id: string;
  gameId: string;
  ownerPlayerId: number;
  title: string;
  description?: string;
  counterpartPlayerIds: number[];
  status: 'active' | 'completed' | 'abandoned';
  priority: 'low' | 'medium' | 'high';
  createdTurn: number;
  updatedTurn: number;
  resolvedTurn?: number;
  evidence: PoliticalEvidenceRef[];
}

/** Bounded memory view supplied to a single unified wake or read-model consumer. */
export interface PoliticalMemorySnapshot {
  goals: PoliticalGoal[];
  commitments: PoliticalCommitment[];
  relationships: PoliticalRelationship[];
  beliefs: PoliticalBelief[];
  episodes: PoliticalEpisode[];
  projects: PoliticalProject[];
}

/** Input for creating a goal. The owner and record ID remain runtime-owned. */
export interface CreateGoalInput { title: string; description?: string; priority: PoliticalGoal['priority']; rationale?: string; evidence?: PoliticalEvidenceRef[]; }

/** Input for recording a commitment. The owner is always the active civilization. */
export interface RecordCommitmentInput { parties: number[]; kind: PoliticalCommitment['kind']; summary: string; terms?: string; dueTurn?: number; visibility: PoliticalCommitment['visibility']; evidence?: PoliticalEvidenceRef[]; }

/** Constrained relationship adjustment requested by a model tool. */
export interface AdjustRelationshipInput { counterpartPlayerId: number; dimension: 'trust' | 'grievance' | 'favor' | 'threat'; direction: 'increase' | 'decrease'; magnitude: 'slight' | 'moderate' | 'major'; reason?: string; evidence?: PoliticalEvidenceRef[]; }

/** Input for a subjective belief. */
export interface UpsertBeliefInput { id?: string; subject: string; claim: string; confidence: PoliticalBelief['confidence']; evidence?: PoliticalEvidenceRef[]; }

/** Input for an important episode. */
export interface RememberEpisodeInput { turn?: number; importance: PoliticalEpisode['importance']; summary: string; counterpartPlayerIds?: number[]; tags?: string[]; evidence?: PoliticalEvidenceRef[]; }

/** Input for creating a multi-turn political project. */
export interface CreateProjectInput { title: string; description?: string; counterpartPlayerIds?: number[]; priority: PoliticalProject['priority']; evidence?: PoliticalEvidenceRef[]; }
