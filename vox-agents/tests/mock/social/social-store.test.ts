import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SocialStore } from '../../../src/social/store/social-store.js';

const tempDirectories: string[] = [];

/** Create a store backed by a disposable temporary SQLite database. */
function createStore(): SocialStore {
  const directory = mkdtempSync(join(tmpdir(), 'vox-deorum-social-'));
  tempDirectories.push(directory);
  return new SocialStore(join(directory, 'social.sqlite'));
}

/** Remove temporary databases after each test. */
afterEach(() => { for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('SocialStore', () => {
  it('should create WORLD and enforce actor-bound message writes', async () => {
    const store = createStore();
    await store.createSession({ id: 'session-1', humanActorId: 'human' }, [
      { id: 'human', ordinal: 0, control: 'human', displayName: 'Human' },
      { id: 'alice', ordinal: 1, control: 'model', displayName: 'Alice', modelRef: 'model-a' },
    ]);
    expect((await store.listChannels('session-1', 'human')).map((channel) => channel.id)).toEqual(['world']);
    const message = await store.appendMessage({ sessionId: 'session-1', actorId: 'human', channelId: 'world', content: 'hello', idempotencyKey: 'run-1' });
    expect(message.speakerActorId).toBe('human');
    expect((await store.appendMessage({ sessionId: 'session-1', actorId: 'human', channelId: 'world', content: 'changed', idempotencyKey: 'run-1' })).id).toBe(message.id);
    await expect(store.appendMessage({ sessionId: 'session-1', actorId: 'unknown', channelId: 'world', content: 'spoof' })).rejects.toThrow();
    await store.close();
  });

  it('should make canonical DMs idempotent and private', async () => {
    const store = createStore();
    await store.createSession({ id: 'session-2', humanActorId: 'human' }, [
      { id: 'human', ordinal: 0, control: 'human', displayName: 'Human' },
      { id: 'alice', ordinal: 1, control: 'model', displayName: 'Alice' },
      { id: 'bob', ordinal: 2, control: 'model', displayName: 'Bob' },
    ]);
    const first = await store.openDm('session-2', 'alice', 'human', 'Private');
    const second = await store.openDm('session-2', 'human', 'alice', 'Different title');
    expect(second.id).toBe(first.id);
    await store.appendMessage({ sessionId: 'session-2', actorId: 'alice', channelId: first.id, content: 'secret' });
    expect((await store.listChannels('session-2', 'bob')).some((channel) => channel.id === first.id)).toBe(false);
    expect((await store.readMessages('session-2', first.id, 'bob')).messages).toEqual([]);
    await store.close();
  });

  it('should enforce group history boundaries across invitation and decline', async () => {
    const store = createStore();
    await store.createSession({ id: 'session-3', humanActorId: 'human' }, [
      { id: 'human', ordinal: 0, control: 'human', displayName: 'Human' },
      { id: 'alice', ordinal: 1, control: 'model', displayName: 'Alice' },
      { id: 'bob', ordinal: 2, control: 'model', displayName: 'Bob' },
    ]);
    const group = await store.createGroup('session-3', 'alice', 'Northern Compact');
    await store.appendMessage({ sessionId: 'session-3', actorId: 'alice', channelId: group.id, content: 'before invite' });
    const invite = await store.invite(group.id, 'bob', 'alice');
    await store.appendMessage({ sessionId: 'session-3', actorId: 'alice', channelId: group.id, content: 'after invite' });
    expect((await store.readMessages('session-3', group.id, 'bob')).messages.map((message) => message.content)).toEqual([]);
    await store.resolveInvitation(group.id, 'bob', true);
    expect((await store.readMessages('session-3', group.id, 'bob')).messages.map((message) => message.content)).toEqual(['after invite']);
    expect(invite.visibleAfterMessageId).toBe(1);
    await store.leaveGroup(group.id, 'bob');
    await store.appendMessage({ sessionId: 'session-3', actorId: 'alice', channelId: group.id, content: 'during absence' });
    expect((await store.readMessages('session-3', group.id, 'bob')).messages.map((message) => message.content)).toEqual(['after invite']);
    await store.close();
  });

  it('should keep private memory and intentions durable across reopen', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vox-deorum-social-reopen-'));
    tempDirectories.push(directory);
    const path = join(directory, 'social.sqlite');
    const first = new SocialStore(path);
    await first.createSession({ id: 'session-4', humanActorId: 'human' }, [{ id: 'human', ordinal: 0, control: 'human', displayName: 'Human' }]);
    await first.updateMemory('human', 'remember this');
    await first.enqueueIntention({ id: 'intention-1', actorId: 'human', kind: 'idle', channelId: null, sourceMessageId: null, priority: 1, state: 'queued', notBefore: new Date().toISOString(), payload: null, dedupeKey: 'idle:human' });
    await first.close();
    const reopened = new SocialStore(path);
    expect((await reopened.getMemory('human'))?.content).toBe('remember this');
    expect((await reopened.enqueueIntention({ id: 'intention-2', actorId: 'human', kind: 'idle', channelId: null, sourceMessageId: null, priority: 1, state: 'queued', notBefore: new Date().toISOString(), payload: null, dedupeKey: 'idle:human' })).id).toBe('intention-1');
    await reopened.close();
  });
});
