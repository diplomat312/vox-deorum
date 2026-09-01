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

  it('should reserve cascade budget before calling the provider', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vox-deorum-social-budget-'));
    const store = new SocialStore(join(directory, 'scheduler.sqlite'));
    cleanups.push(async () => { await store.close(); rmSync(directory, { recursive: true, force: true }); });
    const actors: SocialActorType[] = [
      { id: 'human', ordinal: 0, control: 'human', displayName: 'Human', sessionId: 'budget', createdAt: new Date().toISOString(), status: 'active' },
      { id: 'alice', ordinal: 1, control: 'model', displayName: 'Alice', modelRef: 'openrouter/test/alice', sessionId: 'budget', createdAt: new Date().toISOString(), status: 'active' },
    ];
    await store.createSession({ id: 'budget', humanActorId: 'human' }, actors);
    const events = new SocialEventHub(); const lanes = new Map(actors.map((actor) => [actor.id, new ActorLane()])); const executor = { decide: vi.fn(async () => ({ kind: 'reply' as const, content: 'must not run' })) }; const scheduler = new SocialScheduler(store, async () => actors, lanes, events, executor);
    await store.commitHumanMessage({ sessionId: 'budget', actorId: 'human', channelId: 'world', content: 'Budget check', budget: { maxModelRuns: 0, maxCommittedModelMessages: 1, maxRepliesPerActor: 1, maxWallClockMs: 60_000 } });
    scheduler.kick(); await scheduler.waitForIdle(); scheduler.stop();
    expect(executor.decide).not.toHaveBeenCalled();
    expect((await store.listDecisionDiagnostics('budget'))[0]?.validationOutcome).toBe('skipped-budget');
  });

  it('should coalesce queued reply opportunities onto the newest committed message', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vox-deorum-social-coalesce-'));
    const store = new SocialStore(join(directory, 'scheduler.sqlite'));
    cleanups.push(async () => { await store.close(); rmSync(directory, { recursive: true, force: true }); });
    const actors: SocialActorType[] = [
      { id: 'human', ordinal: 0, control: 'human', displayName: 'Human', sessionId: 'coalesce', createdAt: new Date().toISOString(), status: 'active' },
      { id: 'alice', ordinal: 1, control: 'model', displayName: 'Alice', modelRef: 'openrouter/test/alice', sessionId: 'coalesce', createdAt: new Date().toISOString(), status: 'active' },
    ];
    await store.createSession({ id: 'coalesce', humanActorId: 'human' }, actors);
    const first = await store.commitHumanMessage({ sessionId: 'coalesce', actorId: 'human', channelId: 'world', content: 'First', budget: { maxModelRuns: 6, maxCommittedModelMessages: 2, maxRepliesPerActor: 1, maxWallClockMs: 60_000 } });
    const second = await store.commitHumanMessage({ sessionId: 'coalesce', actorId: 'human', channelId: 'world', content: 'Second', budget: { maxModelRuns: 6, maxCommittedModelMessages: 2, maxRepliesPerActor: 1, maxWallClockMs: 60_000 } });
    expect(second.createdIntentions[0]?.id).toBe(first.createdIntentions[0]?.id);
    expect(second.createdIntentions[0]?.sourceMessageId).toBe(second.message.id);
  });

  it('should preserve a human interruption for an active provider and avoid duplicate follow-ups', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vox-deorum-social-interrupt-'));
    const store = new SocialStore(join(directory, 'scheduler.sqlite'));
    cleanups.push(async () => { await store.close(); rmSync(directory, { recursive: true, force: true }); });
    const actors: SocialActorType[] = [
      { id: 'human', ordinal: 0, control: 'human', displayName: 'Human', sessionId: 'interrupt', createdAt: new Date().toISOString(), status: 'active' },
      { id: 'alice', ordinal: 1, control: 'model', displayName: 'Alice', modelRef: 'openrouter/test/alice', sessionId: 'interrupt', createdAt: new Date().toISOString(), status: 'active' },
      { id: 'bob', ordinal: 2, control: 'model', displayName: 'Bob', modelRef: 'openrouter/test/bob', sessionId: 'interrupt', createdAt: new Date().toISOString(), status: 'active' },
    ];
    await store.createSession({ id: 'interrupt', humanActorId: 'human' }, actors);
    const events = new SocialEventHub(); const lanes = new Map(actors.map((actor) => [actor.id, new ActorLane()]));
    let resolveAliceStarted!: () => void; const aliceStarted = new Promise<void>((resolve) => { resolveAliceStarted = resolve; }); let resolveAliceProvider!: () => void; const aliceProviderDone = new Promise<void>((resolve) => { resolveAliceProvider = resolve; }); let activeIntentionId = ''; const calls = new Map<string, number>(); const contexts = new Map<string, string[]>();
    const executor = { decide: vi.fn(async (actor: SocialActorType, context: SocialContextBundle) => { calls.set(actor.id, (calls.get(actor.id) ?? 0) + 1); contexts.set(actor.id, [...(contexts.get(actor.id) ?? []), context.messages.map((message) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n')]); if (actor.id === 'alice' && calls.get(actor.id) === 1) { const intention = await store.getIntention(activeIntentionId); expect(intention?.modelStartedAt).toBeTruthy(); resolveAliceStarted(); await aliceProviderDone; return { kind: 'reply' as const, content: 'Alice answers after input A.' }; } return { kind: 'pass' as const }; }) };
    const scheduler = new SocialScheduler(store, async () => actors, lanes, events, executor);
    const first = await store.commitHumanMessage({ sessionId: 'interrupt', actorId: 'human', channelId: 'world', content: 'Input A', budget: { maxModelRuns: 12, maxCommittedModelMessages: 6, maxRepliesPerActor: 3, maxWallClockMs: 60_000 } });
    const aliceIntention = first.createdIntentions.find((intention) => intention.actorId === 'alice'); expect(aliceIntention).toBeDefined(); activeIntentionId = aliceIntention!.id;
    scheduler.kick();
    await aliceStarted;
    const second = await store.commitHumanMessage({ sessionId: 'interrupt', actorId: 'human', channelId: 'world', content: 'Input B', budget: { maxModelRuns: 12, maxCommittedModelMessages: 6, maxRepliesPerActor: 3, maxWallClockMs: 60_000 } });
    expect(second.createdIntentions.some((intention) => intention.actorId === 'alice')).toBe(true);
    resolveAliceProvider(); await scheduler.waitForIdle(); scheduler.stop();
    expect(calls.get('alice')).toBeLessThanOrEqual(2);
    expect(calls.get('bob')).toBeLessThanOrEqual(1);
    expect(contexts.get('alice')?.some((context) => context.includes('Input B'))).toBe(true);
    expect(contexts.get('bob')?.some((context) => context.includes('Input B'))).toBe(true);
  });

  it('should enforce committed-message, actor, wall-clock, and PASS budgets before provider calls', async () => {
    const cases = [
      { id: 'message-cap', budget: { maxModelRuns: 5, maxCommittedModelMessages: 0, maxRepliesPerActor: 2, maxWallClockMs: 60_000 }, calls: 0 },
      { id: 'actor-cap', budget: { maxModelRuns: 5, maxCommittedModelMessages: 2, maxRepliesPerActor: 0, maxWallClockMs: 60_000 }, calls: 0 },
      { id: 'wall-cap', budget: { maxModelRuns: 5, maxCommittedModelMessages: 2, maxRepliesPerActor: 2, maxWallClockMs: 0 }, calls: 0 },
      { id: 'pass-cap', budget: { maxModelRuns: 1, maxCommittedModelMessages: 2, maxRepliesPerActor: 2, maxWallClockMs: 60_000 }, calls: 1 },
    ];
    for (const testCase of cases) {
      const directory = mkdtempSync(join(tmpdir(), `vox-deorum-social-${testCase.id}-`));
      const store = new SocialStore(join(directory, 'scheduler.sqlite'));
      cleanups.push(async () => { await store.close(); rmSync(directory, { recursive: true, force: true }); });
      const actors: SocialActorType[] = [{ id: 'human', ordinal: 0, control: 'human', displayName: 'Human', sessionId: testCase.id, createdAt: new Date().toISOString(), status: 'active' }, { id: 'alice', ordinal: 1, control: 'model', displayName: 'Alice', modelRef: 'openrouter/test/alice', sessionId: testCase.id, createdAt: new Date().toISOString(), status: 'active' }];
      await store.createSession({ id: testCase.id, humanActorId: 'human' }, actors); const events = new SocialEventHub(); const lanes = new Map(actors.map((actor) => [actor.id, new ActorLane()])); const executor = { decide: vi.fn(async () => ({ kind: 'pass' as const })) }; const scheduler = new SocialScheduler(store, async () => actors, lanes, events, executor);
      await store.commitHumanMessage({ sessionId: testCase.id, actorId: 'human', channelId: 'world', content: testCase.id, budget: testCase.budget }); scheduler.kick(); await scheduler.waitForIdle(); scheduler.stop();
      expect(executor.decide).toHaveBeenCalledTimes(testCase.calls); const cascade = await store.getCascade(`msg:1`); expect(cascade?.state).toBe(testCase.id === 'pass-cap' ? 'completed' : 'exhausted'); if (testCase.id === 'pass-cap') expect(cascade?.committedModelMessages).toBe(0);
    }
  });

  it('should record actual lane wait rather than claim time', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vox-deorum-social-queue-wait-')); const store = new SocialStore(join(directory, 'scheduler.sqlite')); cleanups.push(async () => { await store.close(); rmSync(directory, { recursive: true, force: true }); });
    const actors: SocialActorType[] = [{ id: 'human', ordinal: 0, control: 'human', displayName: 'Human', sessionId: 'queue-wait', createdAt: new Date().toISOString(), status: 'active' }, { id: 'alice', ordinal: 1, control: 'model', displayName: 'Alice', modelRef: 'openrouter/test/alice', sessionId: 'queue-wait', createdAt: new Date().toISOString(), status: 'active' }, { id: 'bob', ordinal: 2, control: 'model', displayName: 'Bob', modelRef: 'openrouter/test/bob', sessionId: 'queue-wait', createdAt: new Date().toISOString(), status: 'active' }];
    await store.createSession({ id: 'queue-wait', humanActorId: 'human' }, actors); const events = new SocialEventHub(); const lanes = new Map(actors.map((actor) => [actor.id, new ActorLane()])); let first = true; const executor = { decide: vi.fn(async (actor: SocialActorType) => { if (actor.id === 'alice' && first) { first = false; await new Promise((resolve) => setTimeout(resolve, 25)); } return { kind: 'pass' as const }; }) }; const scheduler = new SocialScheduler(store, async () => actors, lanes, events, executor);
    await store.commitHumanMessage({ sessionId: 'queue-wait', actorId: 'human', channelId: 'world', content: 'queue', budget: { maxModelRuns: 4, maxCommittedModelMessages: 2, maxRepliesPerActor: 1, maxWallClockMs: 60_000 } }); scheduler.kick(); await scheduler.waitForIdle(); scheduler.stop(); const diagnostics = await store.listDecisionDiagnostics('queue-wait'); const waits = diagnostics.filter((diagnostic) => diagnostic.selectedKind === 'pass').map((diagnostic) => diagnostic.queueWaitMs ?? 0); expect(waits.length).toBe(2); expect(Math.max(...waits)).toBeGreaterThan(Math.min(...waits));
  });
});
