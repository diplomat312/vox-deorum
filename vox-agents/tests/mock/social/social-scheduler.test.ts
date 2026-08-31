import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SocialStore } from '../../../src/social/store/social-store.js';
import { ActorLane } from '../../../src/social/runtime/actor-lane.js';
import { SocialScheduler } from '../../../src/social/runtime/social-scheduler.js';
import { SocialEventHub } from '../../../src/social/events/social-event-hub.js';
import type { SocialDecisionExecutor } from '../../../src/social/runtime/social-model-executor.js';
import type { SocialContextBundle } from '../../../src/social/context/social-context-builder.js';
import type { SocialActor as SocialActorType } from '../../../src/social/types.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

class ScriptedExecutor implements SocialDecisionExecutor {
  public readonly contexts = new Map<string, string[]>();
  public async decide(actor: SocialActorType, context: SocialContextBundle): Promise<{ kind: 'reply'; content: string } | { kind: 'pass' }> {
    const serialized = context.messages.map((message) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content));
    this.contexts.set(actor.id, [...(this.contexts.get(actor.id) ?? []), ...serialized]);
    if (actor.id === 'alice') return { kind: 'reply', content: 'Alice proposes a plan.' };
    if (actor.id === 'bob' && serialized.some((value) => value.includes('Alice proposes a plan.'))) return { kind: 'reply', content: 'Bob responds to Alice.' };
    return { kind: 'pass' };
  }
}

describe('SocialScheduler', () => {
  it('continues AI speech and gives later actors fresh committed context', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vox-deorum-social-scheduler-'));
    const store = new SocialStore(join(directory, 'scheduler.sqlite'));
    cleanups.push(async () => { await store.close(); rmSync(directory, { recursive: true, force: true }); });
    const actors: SocialActorType[] = [
      { id: 'human', ordinal: 0, control: 'human', displayName: 'Human', sessionId: 'scheduler', createdAt: new Date().toISOString(), status: 'active' },
      { id: 'alice', ordinal: 1, control: 'model', displayName: 'Alice', modelRef: 'openrouter/test/alice', sessionId: 'scheduler', createdAt: new Date().toISOString(), status: 'active' },
      { id: 'bob', ordinal: 2, control: 'model', displayName: 'Bob', modelRef: 'openrouter/test/bob', sessionId: 'scheduler', createdAt: new Date().toISOString(), status: 'active' },
    ];
    await store.createSession({ id: 'scheduler', humanActorId: 'human' }, actors);
    const events = new SocialEventHub();
    const lanes = new Map(actors.map((actor) => [actor.id, new ActorLane()]));
    const executor = new ScriptedExecutor();
    const scheduler = new SocialScheduler(store, async () => actors, lanes, events, executor);
    const humanMutation = await store.commitHumanMessage({ sessionId: 'scheduler', actorId: 'human', channelId: 'world', content: 'Who wants to propose a plan?', budget: { maxModelRuns: 24, maxCommittedModelMessages: 12, maxRepliesPerActor: 4, maxWallClockMs: 90_000 } });
    expect(humanMutation.createdIntentions.length).toBe(2);
    scheduler.kick();
    await scheduler.waitForIdle();
    scheduler.stop();
    const messages = (await store.readMessages('scheduler', 'world', 'human')).messages;
    expect(messages.map((message) => message.content)).toContain('Alice proposes a plan.');
    expect(messages.map((message) => message.content)).toContain('Bob responds to Alice.');
    expect(executor.contexts.get('bob')?.some((value) => value.includes('Alice proposes a plan.'))).toBe(true);
    const diagnostics = await store.listDecisionDiagnostics('scheduler');
    expect(diagnostics.some((diagnostic) => diagnostic.actorId === 'alice' && diagnostic.selectedKind === 'reply' && diagnostic.applicationOutcome === 'send_message')).toBe(true);
  });

  it('should execute channel-less player-mind intentions under only the actor lane', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vox-deorum-social-player-mind-'));
    const store = new SocialStore(join(directory, 'scheduler.sqlite'));
    cleanups.push(async () => { await store.close(); rmSync(directory, { recursive: true, force: true }); });
    const actors: SocialActorType[] = [
      { id: 'human', ordinal: 0, control: 'human', displayName: 'Human', sessionId: 'player-mind', createdAt: new Date().toISOString(), status: 'active' },
      { id: 'alice', ordinal: 1, control: 'model', displayName: 'Alice', modelRef: 'openrouter/test/alice', sessionId: 'player-mind', createdAt: new Date().toISOString(), status: 'active' },
    ];
    await store.createSession({ id: 'player-mind', humanActorId: 'human' }, actors);
    const events = new SocialEventHub(); const lanes = new Map(actors.map((actor) => [actor.id, new ActorLane()])); const executor = { decide: vi.fn(async (_actor: SocialActorType, context: SocialContextBundle) => { expect(context.executionScope).toBe('player-mind'); return { kind: 'pass' as const, reasonCode: 'no-action' }; }) };
    const scheduler = new SocialScheduler(store, async () => actors, lanes, events, executor);
    await store.enqueueIntention({ id: 'mind-1', actorId: 'alice', kind: 'strategic-review', channelId: null, sourceMessageId: null, priority: 1, state: 'queued', notBefore: new Date().toISOString(), payload: null, dedupeKey: 'mind-1' });
    scheduler.kick(); await scheduler.waitForIdle(); scheduler.stop(); expect(executor.decide).toHaveBeenCalledTimes(1);
  });

  it('should cancel an unknown intention kind instead of silently passing it', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vox-deorum-social-unknown-'));
    const store = new SocialStore(join(directory, 'scheduler.sqlite'));
    cleanups.push(async () => { await store.close(); rmSync(directory, { recursive: true, force: true }); });
    const actors: SocialActorType[] = [
      { id: 'human', ordinal: 0, control: 'human', displayName: 'Human', sessionId: 'unknown', createdAt: new Date().toISOString(), status: 'active' },
      { id: 'alice', ordinal: 1, control: 'model', displayName: 'Alice', modelRef: 'openrouter/test/alice', sessionId: 'unknown', createdAt: new Date().toISOString(), status: 'active' },
    ];
    await store.createSession({ id: 'unknown', humanActorId: 'human' }, actors); const events = new SocialEventHub(); const lanes = new Map(actors.map((actor) => [actor.id, new ActorLane()])); const executor = { decide: vi.fn() }; const scheduler = new SocialScheduler(store, async () => actors, lanes, events, executor);
    await store.enqueueIntention({ id: 'unknown-1', actorId: 'alice', kind: 'future-kind', channelId: null, sourceMessageId: null, priority: 1, state: 'queued', notBefore: new Date().toISOString(), payload: null, dedupeKey: 'unknown-1' }); scheduler.kick(); await scheduler.waitForIdle(); scheduler.stop(); expect(executor.decide).not.toHaveBeenCalled();
  });
});
