/** Stable identifiers and public domain types for the game-independent social runtime. */
export type SocialActorControl = 'human' | 'model';
export type SocialChannelKind = 'world' | 'dm' | 'group';
export type SocialMembershipStatus = 'invited' | 'active' | 'declined' | 'left';
export type SocialIntentionState = 'queued' | 'running' | 'deferred' | 'completed' | 'cancelled';
export type SocialOperationClass = 'human-triggered' | 'ai-cascade' | 'invitation' | 'autonomous';

export interface SocialActorDefinition { id: string; ordinal: number; control: SocialActorControl; displayName: string; modelRef?: string; profile?: string; }
export interface SocialSessionDefinition { id: string; humanActorId: string; title?: string; archived?: boolean; createdAt?: string; updatedAt?: string; }
export interface SocialActor extends SocialActorDefinition { sessionId: string; createdAt: string; status: 'active' | 'inactive'; }
export interface SocialChannel { id: string; sessionId: string; kind: SocialChannelKind; title: string; createdByActorId: string; canonicalKey: string | null; createdAt: string; archived: boolean; }
export interface SocialMembership { id: string; channelId: string; actorId: string; status: SocialMembershipStatus; invitedByActorId: string | null; visibleAfterMessageId: number; leftAfterMessageId: number | null; createdAt: string; updatedAt: string; }
export interface SocialMessage { id: number; channelId: string; speakerActorId: string; content: string; replyToMessageId: number | null; createdAt: string; intentionId: string | null; idempotencyKey: string | null; }
export interface SocialMemory { actorId: string; revision: number; content: string; updatedAt: string; sourceRunId: string | null; }
export interface SocialIntention { id: string; actorId: string; kind: string; channelId: string | null; sourceMessageId: number | null; priority: number; state: SocialIntentionState; notBefore: string; payload: string | null; dedupeKey: string | null; attemptCount: number; claimedAt?: string; result?: string; lastError: string | null; createdAt: string; updatedAt: string; cascadeId?: string; operationClass?: SocialOperationClass; completedAt?: string; }
export interface SocialCascade { id: string; sessionId: string; rootKind: 'message' | 'autonomous' | 'system'; rootMessageId: number | null; state: 'active' | 'completed' | 'exhausted' | 'cancelled'; modelRuns: number; committedModelMessages: number; maxModelRuns: number; maxCommittedModelMessages: number; maxRepliesPerActor: number; maxWallClockMs: number; createdAt: string; updatedAt: string; }
export interface SocialCascadeBudget { maxModelRuns: number; maxCommittedModelMessages: number; maxRepliesPerActor: number; maxWallClockMs: number; }
export interface SocialInvitation { membershipId: string; channelId: string; channelTitle: string; invitedByActorId: string; invitedByDisplayName: string; createdAt: string; }
export interface VisibleMessagePage { messages: SocialMessage[]; hasMore: boolean; }
