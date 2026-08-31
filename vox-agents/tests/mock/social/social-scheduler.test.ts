import { afterEach, describe, expect, it } from 'vitest';
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
  public async decide(actor: SocialActorType, context: SocialContextBundle): Promise<{ outcome: 'speak'; content: string } | { outcome: 'pass' }> {
    const serialized = context.messages.map((message) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content));
    this.contexts.set(actor.id, [...(this.contexts.get(actor.id) ?? []), ...serialized]);
    if (actor.id === 'alice') return { outcome: 'speak', content: 'Alice proposes a plan.' };
    if (actor.id === 'bob' && serialized.some((value) => value.includes('Alice proposes a plan.'))) return { outcome: 'speak', content: 'Bob responds to Alice.' };
    return { outcome: 'pass' };
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
  });
});
