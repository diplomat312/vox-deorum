/**
 * Type definitions for the Vox Agents UI
 * Re-exports shared types from the backend and adds UI-specific types
 */

// Re-export all shared types from the backend source tree
export * from '../../../src/types/index';

import type { DealTranscriptMessage } from '../../../src/types/index';
import type {
  DealReduction as DealReductionOf,
  ProposalOutcome as ProposalOutcomeOf,
} from '@vox/utils/diplomacy/deal/deal-reduce';

/** UI-specialized reduction for the typed deal transcript. */
export type DealReduction = DealReductionOf<DealTranscriptMessage>;

/** UI-specialized per-proposal outcome for the typed deal transcript. */
export type ProposalOutcome = ProposalOutcomeOf<DealTranscriptMessage>;

// UI-specific type extensions can be added here if needed in the future

/** Shared label and value shape for select controls. */
export type SelectOption<T = string> = { label: string; value: T; description?: string };

/** Mode used when opening the session configuration dialog. */
export type ConfigDialogMode = 'add' | 'edit' | 'duplicate';

// ============= Social layer (Civ pilot) =============

/** One civilization seat the human can control from the Social tab. */
export interface SocialSeat {
  seat: number;
  civ: string;
  leader: string;
  playedBy?: 'codex' | 'opencode' | 'human';
  sessionId?: string;
  stateFile?: string;
  lastSeenTurn?: number;
  lastTurnAt?: number;
  messageCount?: number;
}

/** Group registry entry (mirrors live/channels.json). */
export interface SocialGroup {
  id: string;
  title: string;
  createdBy: number;
  createdAt?: string;
  archived: boolean;
  members: Array<{ seat: number; status: string; visibleAfter?: number; leftAfter?: number | null }>;
}

/** Response of GET /api/social/status. */
export interface SocialStatusResponse {
  socialDir: string;
  game: { gameID: string; turn: number; activePlayerId: number } | null;
  seats: SocialSeat[];
  groups: SocialGroup[];
}

/** A world-channel message. */
export interface SocialWorldMessage {
  ID: number;
  Turn: number;
  SpeakerID: number;
  SpeakerRole: string | null;
  Content: string;
  ReplyToID: number | null;
  CreatedAt: number;
  speaker: string;
}

/** A DM / transcript row. */
export interface SocialDmMessage {
  ID?: number;
  Turn: number;
  SpeakerID: number;
  SpeakerRole?: string | null;
  MessageType?: string;
  Content?: string;
  Payload?: Record<string, unknown>;
  speaker: string;
}

/** Response of GET /api/social/messages. */
export interface SocialMessagesResponse {
  seat: number;
  lastSeenTurn: number;
  mcpDown?: boolean;
  world: SocialWorldMessage[];
  groups: Array<{
    id: string;
    title: string;
    createdBy: number;
    archived: boolean;
    myStatus: string;
    members: Array<{ seat: number; status: string }>;
    messages: Array<SocialWorldMessage & { body: string }>;
  }>;
  dms: Array<{ seat: number; civ: string; leader: string; messages: SocialDmMessage[] }>;
  invites: string[];
}
