import type { Generated } from 'kysely';

export interface SocialSessionRow { id: string; humanActorId: string; createdAt: string; }
export interface SocialActorRow { id: string; sessionId: string; ordinal: number; control: string; displayName: string; modelRef: string | null; profile: string | null; createdAt: string; status: string; }
export interface SocialChannelRow { id: string; sessionId: string; kind: string; title: string; createdByActorId: string; canonicalKey: string | null; createdAt: string; archived: number; }
export interface SocialMembershipRow { id: string; channelId: string; actorId: string; status: string; invitedByActorId: string | null; visibleAfterMessageId: number; leftAfterMessageId: number | null; createdAt: string; updatedAt: string; }
export interface SocialMessageRow { id: Generated<number>; channelId: string; speakerActorId: string; content: string; replyToMessageId: number | null; createdAt: string; intentionId: string | null; idempotencyKey: string | null; }
export interface SocialMemoryRow { actorId: string; revision: number; content: string; updatedAt: string; sourceRunId: string | null; }
export interface SocialIntentionRow { id: string; actorId: string; kind: string; channelId: string | null; sourceMessageId: number | null; priority: number; state: string; notBefore: string; payload: string | null; dedupeKey: string | null; attemptCount: number; lastError: string | null; createdAt: string; updatedAt: string; }
export interface SocialDatabase { socialSessions: SocialSessionRow; socialActors: SocialActorRow; socialChannels: SocialChannelRow; socialMemberships: SocialMembershipRow; socialMessages: SocialMessageRow; socialMemories: SocialMemoryRow; socialIntentions: SocialIntentionRow; }
