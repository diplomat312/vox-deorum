import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SocialStore } from '../../../src/social/store/social-store.js';
import { SocialEventHub } from '../../../src/social/events/social-event-hub.js';
import { SocialDecisionExecutor } from '../../../src/social/runtime/social-decision-executor.js';
import { decodeSocialDecision } from '../../../src/social/runtime/social-decision-tools.js';
import { createSocialReferenceSet } from '../../../src/social/context/social-context-builder.js';
import { SocialContextBuilder } from '../../../src/social/context/social-context-builder.js';
import { createSocialDecisionTools } from '../../../src/social/runtime/social-decision-tools.js';
import type { SocialActor, SocialIntention } from '../../../src/social/types.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

/** Create a disposable social store with one human and two model actors. */
async function createFixture(): Promise<{ store: SocialStore; actors: SocialActor[] }> {
  const directory = mkdtempSync(join(tmpdir(), 'vox-deorum-social-decisions-')); const store = new SocialStore(join(directory, 'social.sqlite')); cleanups.push(async () => { await store.close(); rmSync(directory, { recursive: true, force: true }); });
  const actors: SocialActor[] = [
    { id: 'human', ordinal: 0, control: 'human', displayName: 'Human', sessionId: 'decisions', createdAt: new Date().toISOString(), status: 'active' },
    { id: 'alice', ordinal: 1, control: 'model', displayName: 'Alice', sessionId: 'decisions', createdAt: new Date().toISOString(), status: 'active' },
    { id: 'bob', ordinal: 2, control: 'model', displayName: 'Bob', sessionId: 'decisions', createdAt: new Date().toISOString(), status: 'active' },
  ];
  await store.createSession({ id: 'decisions', humanActorId: 'human' }, actors); return { store, actors };
}

/** Reserve one queued intention so an action application has runtime authority. */
async function running(store: SocialStore, id: string, actorId: string, kind = 'autonomous-social', channelId: string | null = null): Promise<SocialIntention> { await store.enqueueIntention({ id, actorId, kind, channelId, sourceMessageId: null, priority: 1000, state: 'queued', notBefore: new Date().toISOString(), payload: null, dedupeKey: id }); return (await store.claimNextIntention())!; }

describe('structured social decisions', () => {
  it('should decode one tool call and reject zero or multiple calls', () => {
    expect(decodeSocialDecision([{ toolName: 'social_pass', input: { reason: 'quiet' } }])).toEqual({ kind: 'pass', reasonCode: 'quiet' });
    expect(() => decodeSocialDecision([])).toThrow(/exactly one/); expect(() => decodeSocialDecision([{ toolName: 'social_pass', input: {} }, { toolName: 'social_pass', input: {} }])).toThrow(/exactly one/);
    expect(() => decodeSocialDecision([{ toolName: 'social_reply', input: { text: '' } }])).toThrow(/invalid-output/);
  });

  it('should apply DM, group, invitation, leave, and memory decisions through durable store paths', async () => {
    const { store, actors } = await createFixture(); const events = new SocialEventHub(); const applied = new SocialDecisionExecutor(store, events); const actorRefs = createSocialReferenceSet(actors);
    const dmIntention = await running(store, 'dm-1', 'alice'); await applied.apply(actors[1], dmIntention, { kind: 'send_dm', participantRef: 'bob', content: 'Private plan' }, actorRefs); const dm = (await store.listChannels('decisions', 'alice')).find((channel) => channel.kind === 'dm'); expect(dm).toBeDefined(); expect((await store.readMessages('decisions', dm!.id, 'bob')).messages.map((message) => message.content)).toEqual(['Private plan']);
    const groupIntention = await running(store, 'group-1', 'alice'); const groupApplied = await applied.apply(actors[1], groupIntention, { kind: 'start_group', title: 'Secret council', participantRefs: ['bob'], initialMessage: 'Before you join' }, actorRefs); expect(groupApplied.result).toBe('start_group'); const invitation = (await store.listPendingInvitations('decisions', 'bob'))[0]; expect(invitation.channelTitle).toBe('Secret council');
    const acceptIntention = await running(store, 'accept-1', 'bob', 'invitation-decision', invitation.channelId); await applied.apply(actors[2], acceptIntention, { kind: 'respond_invitation', accepted: true }, actorRefs); await store.appendMessage({ sessionId: 'decisions', actorId: 'alice', channelId: invitation.channelId, content: 'After you joined' }); expect((await store.readMessages('decisions', invitation.channelId, 'bob')).messages.map((message) => message.content)).toEqual(['Before you join', 'After you joined']);
    const group = (await store.listChannels('decisions', 'bob')).find((channel) => channel.title === 'Secret council'); const roomRefs = createSocialReferenceSet(actors, group ? [group] : []);
    const leaveIntention = await running(store, 'leave-1', 'bob', 'autonomous-social', invitation.channelId); await applied.apply(actors[2], leaveIntention, { kind: 'leave_group', roomRef: 'secret-council' }, roomRefs); await expect(store.readMessages('decisions', dm!.id, 'bob')).resolves.toBeDefined();
    const hidden = await store.createGroup('decisions', 'human', 'Hidden room', []); const unauthorizedIntention = await running(store, 'unauthorized-1', 'alice'); const hiddenRefs = createSocialReferenceSet(actors, [hidden]); expect((await applied.apply(actors[1], unauthorizedIntention, { kind: 'send_message', roomRef: 'hidden-room', content: 'This must be refused' }, hiddenRefs)).result).toBe('refused');
  });

  it('should expose semantic references and omit runtime-owned routing and memory fields', () => {
    const duplicateActors = [
      { ...({ id: 'first-id', ordinal: 1, control: 'model' as const, displayName: 'Alice', sessionId: 'decisions', createdAt: '', status: 'active' as const }) },
      { ...({ id: 'second-id', ordinal: 2, control: 'model' as const, displayName: 'Alice', sessionId: 'decisions', createdAt: '', status: 'active' as const }) },
    ];
    const refs = createSocialReferenceSet(duplicateActors);
    expect(refs.actors.map((reference) => reference.ref)).toEqual(['alice', 'alice-2']);
    const tools = createSocialDecisionTools('channel-reaction', refs);
    expect(Object.keys(tools)).toEqual(['social_pass', 'social_reply', 'social_send_dm', 'social_start_group']);
    expect(Object.keys(createSocialDecisionTools('player-mind', refs))).not.toContain('social_update_memory');
    const context = new SocialContextBuilder().build(duplicateActors[0], duplicateActors, [], { id: 'i', actorId: 'first-id', kind: 'consider-reply', channelId: 'world', sourceMessageId: null, priority: 1, state: 'queued', notBefore: '', payload: null, dedupeKey: 'i', attemptCount: 0, lastError: null, createdAt: '', updatedAt: '' });
    expect(context.messages[0].content).toContain('[alice] Alice');
    expect(context.messages[0].content).toContain('[alice-2] Alice');
    expect((decodeSocialDecision([{ toolName: 'social_reply', input: { text: 'hello', channelId: 'other-room' } }]) as { kind: string }).kind).toBe('reply');
  });

  it('should omit actions with no legal targets', () => {
    const refs = { actors: [{ ref: 'alice', id: 'alice', label: 'Alice' }], channels: [], dmActors: [], groupParticipants: [], messageRooms: [], inviteRooms: [], inviteParticipants: [], inviteTargets: [], leaveRooms: [] };
    expect(Object.keys(createSocialDecisionTools('player-mind', refs))).toEqual(['social_pass']);
  });

  it('should require an explicit invitation response instead of offering pass', () => {
    const refs = { actors: [], channels: [], inviteRooms: [], inviteParticipants: [], inviteTargets: [], leaveRooms: [] };
    expect(Object.keys(createSocialDecisionTools('invitation-decision', refs))).toEqual(['social_respond_invitation']);
  });
});
