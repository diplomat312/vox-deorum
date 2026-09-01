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
import type { SocialActor, SocialCascade, SocialChannel, SocialDecisionDiagnostic, SocialInvitation, SocialMessage, SocialPacingProfile, VisibleMessagePage } from '../../../src/social/types';

export type { SocialActor, SocialChannel, SocialMessage, VisibleMessagePage };
export type { SocialInvitation };
export interface SocialSessionResponse { sessionId: string; humanActorId: string; actors: SocialActor[]; pacingProfile?: SocialPacingProfile; inspectionAvailable?: boolean; }
export interface SocialChannelsResponse { channels: SocialChannel[]; }
export interface SocialStoredSession { session: { id: string; humanActorId: string; title?: string; archived?: boolean; pacingProfile?: SocialPacingProfile; createdAt?: string; updatedAt?: string }; actors: SocialActor[] }
export interface SocialStoredSessionsResponse { sessions: SocialStoredSession[] }
export interface SocialStartRequest { sessionId?: string; humanActorId?: string; title?: string; pacingProfile?: SocialPacingProfile; dataDirectory?: string; actors: Array<{ id: string; ordinal: number; control: 'human' | 'model'; displayName: string; modelRef?: string; profile?: string }>; }
export interface SocialDiagnosticsResponse { diagnostics: SocialDecisionDiagnostic[]; cascades: SocialCascade[] }
export type { SocialCascade, SocialDecisionDiagnostic, SocialPacingProfile };

/** UI-specialized reduction for the typed deal transcript. */
export type DealReduction = DealReductionOf<DealTranscriptMessage>;

/** UI-specialized per-proposal outcome for the typed deal transcript. */
export type ProposalOutcome = ProposalOutcomeOf<DealTranscriptMessage>;

// UI-specific type extensions can be added here if needed in the future

/** Shared label and value shape for select controls. */
export type SelectOption<T = string> = { label: string; value: T; description?: string };

/** Mode used when opening the session configuration dialog. */
export type ConfigDialogMode = 'add' | 'edit' | 'duplicate';
