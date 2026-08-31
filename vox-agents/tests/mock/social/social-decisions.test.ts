import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SocialStore } from '../../../src/social/store/social-store.js';
import { SocialEventHub } from '../../../src/social/events/social-event-hub.js';
import { SocialDecisionExecutor } from '../../../src/social/runtime/social-decision-executor.js';
import { decodeSocialDecision } from '../../../src/social/runtime/social-decision-tools.js';
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
    expect(decodeSocialDecision([{ toolName: 'social_pass', input: { reasonCode: 'quiet' } }])).toEqual({ kind: 'pass', reasonCode: 'quiet' });
    expect(() => decodeSocialDecision([])).toThrow(/exactly one/); expect(() => decodeSocialDecision([{ toolName: 'social_pass', input: {} }, { toolName: 'social_pass', input: {} }])).toThrow(/exactly one/);
    expect(() => decodeSocialDecision([{ toolName: 'social_send_message', input: { content: '' } }])).toThrow(/invalid-output/);
  });

  it('should apply DM, group, invitation, leave, and memory decisions through durable store paths', async () => {
    const { store, actors } = await createFixture(); const events = new SocialEventHub(); const applied = new SocialDecisionExecutor(store, events);
    const dmIntention = await running(store, 'dm-1', 'alice'); await applied.apply(actors[1], dmIntention, { kind: 'send_dm', targetActorId: 'bob', content: 'Private plan' }); const dm = (await store.listChannels('decisions', 'alice')).find((channel) => channel.kind === 'dm'); expect(dm).toBeDefined(); expect((await store.readMessages('decisions', dm!.id, 'bob')).messages.map((message) => message.content)).toEqual(['Private plan']);
    const groupIntention = await running(store, 'group-1', 'alice'); const groupMutation = await applied.apply(actors[1], groupIntention, { kind: 'create_group', title: 'Secret council', invitedActorIds: ['bob'], initialMessage: 'Before you join' }); expect(groupMutation.result).toBe('create_group'); const invitation = (await store.listPendingInvitations('decisions', 'bob'))[0]; expect(invitation.channelTitle).toBe('Secret council');
    const acceptIntention = await running(store, 'accept-1', 'bob', 'invitation-decision', invitation.channelId); await applied.apply(actors[2], acceptIntention, { kind: 'resolve_invitation', channelId: invitation.channelId, accepted: true }); await store.appendMessage({ sessionId: 'decisions', actorId: 'alice', channelId: invitation.channelId, content: 'After you joined' }); expect((await store.readMessages('decisions', invitation.channelId, 'bob')).messages.map((message) => message.content)).toEqual(['After you joined']);
    const memoryIntention = await running(store, 'memory-1', 'alice'); await applied.apply(actors[1], memoryIntention, { kind: 'update_memory', expectedRevision: 0, content: 'Remember the council' }); expect((await store.getMemory('alice'))?.content).toBe('Remember the council');
    const leaveIntention = await running(store, 'leave-1', 'bob', 'autonomous-social', invitation.channelId); await applied.apply(actors[2], leaveIntention, { kind: 'leave_group', channelId: invitation.channelId }); await expect(store.readMessages('decisions', dm!.id, 'bob')).resolves.toBeDefined();
  });
});
