import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CivilizationMemoryStore } from '../../../src/civilization-memory/civilization-memory-store.js';
import { buildCivilizationMemoryContext } from '../../../src/civilization-memory/civilization-memory-context.js';
import { createCivilizationMemoryTools } from '../../../src/civilization-memory/civilization-memory-tools.js';
import { runCivilizationMemoryMaintenance } from '../../../src/civilization-memory/civilization-memory-maintenance-runner.js';
import { appendSocialFact } from '../../../src/civilization-memory/civilization-memory-ingestion.js';
import { createFakeVoxContext } from '../../helpers/fake-vox-context.js';
import type { StrategistParameters } from '../../../src/strategist/strategy-parameters.js';
import {
  MAX_OUTLOOK_CHARACTERS,
  RECENT_CHRONICLE_HARD_TOKEN_LIMIT,
  RECENT_CHRONICLE_SOFT_TOKEN_LIMIT,
  RECENT_CHRONICLE_TARGET_TOKEN_LIMIT,
  CHRONICLE_RENDER_OVERHEAD_CHARACTERS,
  estimateChronicleTokens,
} from '../../../src/civilization-memory/civilization-memory-budget.js';

const temporaryDirectories: string[] = [];
const openStores: CivilizationMemoryStore[] = [];

/** Create an isolated SQLite path for one deterministic memory test. */
function temporaryPath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'vox-deorum-civilization-memory-'));
  temporaryDirectories.push(directory);
  return join(directory, 'memory.sqlite');
}

/** Track an opened store so Windows can release SQLite files before cleanup. */
function openStore(path = temporaryPath()): CivilizationMemoryStore {
  const store = new CivilizationMemoryStore(path);
  openStores.push(store);
  return store;
}

/** Build the smallest parameter object accepted by the shared memory context. */
function parameters(store: CivilizationMemoryStore, ownerPlayerId = 1, turn = 35): StrategistParameters {
  return {
    playerID: ownerPlayerId,
    gameID: 'game-memory-test',
    turn,
    after: 0,
    before: 0,
    workingMemory: {},
    gameStates: {},
    mode: 'Flavor',
    reports: {},
    metadata: { YouAre: { Name: 'Rome', Leader: 'Augustus' } },
    civilizationMemoryStore: store,
    civilizationMemoryEnabled: true,
  };
}

/** Append one deterministic block with an approximate token size for budget tests. */
function appendTokenBlock(store: CivilizationMemoryStore, scope: { gameId: string; ownerPlayerId: number; turn: number }, tokens: number, index: string): void {
  store.appendChronicle(scope, { turn: scope.turn, kind: 'self-note', text: `${index} ${'x'.repeat(Math.max(0, tokens * 4 - index.length - 1))}` });
}

/** Close stores and remove temporary test directories. */
afterEach(() => {
  for (const store of openStores.splice(0)) store.close();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('CivilizationMemoryStore', () => {
  it('persists one outlook and factual chronicle across reopen', () => {
    const path = temporaryPath();
    const first = openStore(path);
    const scope = { gameId: 'game-memory-test', ownerPlayerId: 1, turn: 35 };
    first.updateOutlook(scope, 'We should preserve the river understanding with Greece.', 0, 'outlook-1');
    first.appendChronicle(scope, { turn: 35, kind: 'private-message', text: 'Greece asked about the river boundary.', dedupeKey: 'transcript:1:1', scope: 'private', participantPlayerIds: [1, 2] });
    first.close();

    const reopened = openStore(path);
    const snapshot = reopened.getSnapshot(scope);
    expect(snapshot.outlook?.text).toContain('river understanding');
    expect(snapshot.recentChronicle).toHaveLength(1);
    reopened.close();
  });

  it('records social scope, authoritative names, audience, and distinct event identities', () => {
    const store = openStore();
    store.registerOwner(1);
    const params = parameters(store, 1, 80);
    params.gameStates[80] = {
      turn: 80,
      reports: {},
      players: {
        '1': { Civilization: 'Rome', Leader: 'Augustus', IsMajor: true },
        '2': { Civilization: 'Greece', Leader: 'Pericles', IsMajor: true },
      },
    };
    appendSocialFact(store, params, { kind: 'dm-message', actorId: 'civ-player-2', channelId: 'dm-1', channelTitle: 'DM with Rome', message: { id: 17, channelId: 'dm-1', speakerActorId: 'civ-player-2', content: 'A bounded private message.', replyToMessageId: null, createdAt: 'now', intentionId: null, idempotencyKey: null }, turn: 80, eventId: 'message-17', recipientActorIds: ['civ-player-1'], entitledActorIds: ['civ-player-1'] });
    appendSocialFact(store, params, { kind: 'group-joined', actorId: 'civ-player-1', channelId: 'group-1', channelTitle: 'Eastern Council', content: 'Joined the group.', turn: 80, eventId: 'membership-1', entitledActorIds: ['civ-player-1'] });
    appendSocialFact(store, params, { kind: 'group-joined', actorId: 'civ-player-1', channelId: 'group-1', channelTitle: 'Eastern Council', content: 'Joined the group again.', turn: 80, eventId: 'membership-2', entitledActorIds: ['civ-player-1'] });
    const entries = store.getAllChronicle({ gameId: 'game-memory-test', ownerPlayerId: 1, turn: 80 });
    expect(entries).toHaveLength(3);
    expect(entries[0]?.text).toContain('Private message · DM with Rome · Greece / Pericles → Rome / Augustus');
    expect(entries[0]?.text).toContain('A bounded private message.');
    expect(entries[1]?.text).toContain('Joined group · Eastern Council · Rome / Augustus');
    store.close();
  });

  it('keeps outlook updates optimistic and retries idempotently', () => {
    const store = openStore();
    const scope = { gameId: 'game-memory-test', ownerPlayerId: 1, turn: 35 };
    const first = store.updateOutlook(scope, 'Initial outlook.', 0, 'same-operation');
    const replay = store.updateOutlook(scope, 'Different text must not replace a committed operation.', 0, 'same-operation');
    expect(replay).toEqual(first);
    expect(() => store.updateOutlook(scope, 'Stale replacement.', 0, 'new-operation')).toThrow(/changed during this wake/);
    store.close();
  });

  it('recovers an Outlook conflict inside the same wake and advances the local revision', async () => {
    const store = openStore();
    const context = createFakeVoxContext('civilization-memory-conflict');
    const scope = { gameId: 'game-memory-test', ownerPlayerId: 1, turn: 35 };
    const paramsA = parameters(store);
    const paramsB = parameters(store);
    paramsB.civilizationMemoryOutlookRevision = 0;
    const tool = createCivilizationMemoryTools(context.asContext())['update-civilization-outlook']!;

    await context.withRun({ parameters: paramsA }, () => tool.execute!({ Outlook: 'Greece is becoming dangerous.' }, { toolCallId: 'outlook-a', messages: [] }));
    const conflict = await context.withRun({ parameters: paramsB }, () => tool.execute!({ Outlook: 'Greece remains cooperative.' }, { toolCallId: 'outlook-b', messages: [] }));
    expect(String(conflict)).toContain('Greece is becoming dangerous.');
    expect(String(conflict)).not.toContain('Greece is both');
    expect(paramsB.civilizationMemoryOutlookRevision).toBe(1);

    await context.withRun({ parameters: paramsB }, () => tool.execute!({ Outlook: 'Greece is dangerous, but its trade remains useful.' }, { toolCallId: 'outlook-b-retry', messages: [] }));
    expect(store.getOutlook(scope)?.revision).toBe(2);
    expect(store.getOutlook(scope)?.text).toContain('trade remains useful');
    store.close();
  });

  it('keeps Current Outlook concise and rejects oversized direct writes', () => {
    const store = openStore();
    const scope = { gameId: 'game-memory-test', ownerPlayerId: 1, turn: 35 };
    expect(() => store.updateOutlook(scope, 'x'.repeat(MAX_OUTLOOK_CHARACTERS + 1), 0, 'too-large')).toThrow(/too long/);
    store.close();
  });

  it('uses soft, target, and hard Chronicle budgets with hysteresis', () => {
    const store = openStore();
    const scope = { gameId: 'game-memory-test', ownerPlayerId: 1, turn: 35 };
    expect(store.needsMaintenance(scope)).toBe(false);
    appendTokenBlock(store, scope, 10, 'small');
    expect(store.needsMaintenance(scope)).toBe(false);
    appendTokenBlock(store, scope, RECENT_CHRONICLE_SOFT_TOKEN_LIMIT - 200, 'below-soft');
    expect(store.needsMaintenance(scope)).toBe(false);
    appendTokenBlock(store, scope, 200, 'over-soft');
    expect(store.needsMaintenance(scope)).toBe(true);
    const beforeCompaction = store.getSnapshot(scope);
    expect(beforeCompaction.uncompactedChronicleTokenCount).toBe(estimateChronicleTokens(store.getAllChronicle(scope)));

    const range = store.selectCompactionRange(scope, { targetRemainingTokens: RECENT_CHRONICLE_TARGET_TOKEN_LIMIT, maxEntries: 100 });
    expect(range).toBeDefined();
    store.commitCompaction(scope, range!, 'The oldest Chronicle facts remain available in raw history.');
    const after = store.getSnapshot(scope);
    expect(after.maintenanceRequired).toBe(false);
    expect(after.uncompactedChronicleTokenCount).toBeLessThanOrEqual(RECENT_CHRONICLE_TARGET_TOKEN_LIMIT + 100);
    expect(after.recentChronicleTokenCount).toBe(estimateChronicleTokens(after.recentChronicle));
    expect(after.uncompactedChronicleTokenCount).toBe(estimateChronicleTokens(after.recentChronicle));

    appendTokenBlock(store, scope, 500, 'small-after-compaction');
    expect(store.needsMaintenance(scope)).toBe(false);
    appendTokenBlock(store, scope, RECENT_CHRONICLE_SOFT_TOKEN_LIMIT, 'eventual-overflow');
    expect(store.needsMaintenance(scope)).toBe(true);
    store.close();
  });

  it('treats the soft threshold as strict and the hard threshold as inclusive', () => {
    const store = openStore();
    const scope = { gameId: 'game-memory-test', ownerPlayerId: 1, turn: 35 };
    const exactSoftText = 's'.repeat(RECENT_CHRONICLE_SOFT_TOKEN_LIMIT * 4 - CHRONICLE_RENDER_OVERHEAD_CHARACTERS);
    store.appendChronicle(scope, { turn: 35, kind: 'self-note', text: exactSoftText });
    expect(store.getSnapshot(scope).uncompactedChronicleTokenCount).toBe(RECENT_CHRONICLE_SOFT_TOKEN_LIMIT);
    expect(store.needsMaintenance(scope)).toBe(false);

    const exactHardText = 'h'.repeat(RECENT_CHRONICLE_HARD_TOKEN_LIMIT * 4 - CHRONICLE_RENDER_OVERHEAD_CHARACTERS);
    const hardStore = openStore();
    hardStore.appendChronicle(scope, { turn: 35, kind: 'self-note', text: exactHardText });
    const snapshot = hardStore.getSnapshot(scope);
    expect(snapshot.recentChronicleTokenCount).toBe(RECENT_CHRONICLE_HARD_TOKEN_LIMIT);
    expect(snapshot.recentChronicleTruncated).toBe(false);
    store.close();
    hardStore.close();
  });

  it('selects a budget-sized oldest range and leaves the raw history intact', () => {
    const store = openStore();
    const scope = { gameId: 'game-memory-test', ownerPlayerId: 1, turn: 35 };
    appendTokenBlock(store, scope, 12_000, 'old-one');
    appendTokenBlock(store, scope, 15_900, 'recent-tail');
    const range = store.selectCompactionRange(scope, { targetRemainingTokens: RECENT_CHRONICLE_TARGET_TOKEN_LIMIT, maxEntries: 100 })!;
    expect(range.entries.map(entry => entry.text.startsWith('old'))).toEqual([true]);
    expect(store.getAllChronicle(scope)).toHaveLength(2);
    store.commitCompaction(scope, range, 'The older facts are preserved as long-term continuity.');
    expect(store.getAllChronicle(scope)).toHaveLength(2);
    expect(store.getSnapshot(scope).recentChronicle[0]?.text).toContain('recent-tail');
    store.close();
  });

  it('keeps the newest history within the hard prompt window when maintenance is unavailable', () => {
    const store = openStore();
    const scope = { gameId: 'game-memory-test', ownerPlayerId: 1, turn: 35 };
    appendTokenBlock(store, scope, RECENT_CHRONICLE_HARD_TOKEN_LIMIT - 8_000, 'older-hot-history');
    appendTokenBlock(store, scope, 20_000, 'newest-hot-history');
    const snapshot = store.getSnapshot(scope);
    expect(snapshot.uncompactedChronicleTokenCount).toBeGreaterThan(RECENT_CHRONICLE_HARD_TOKEN_LIMIT);
    expect(snapshot.recentChronicleTruncated).toBe(true);
    expect(snapshot.recentChronicle[0]?.text).toContain('newest-hot-history');
    expect(store.getAllChronicle(scope)).toHaveLength(2);
    store.close();
  });

  it('bounds a single oversized Chronicle entry without changing raw history', () => {
    const store = openStore();
    const scope = { gameId: 'game-memory-test', ownerPlayerId: 1, turn: 35 };
    const oversized = `oversized-event ${'x'.repeat(RECENT_CHRONICLE_HARD_TOKEN_LIMIT * 4)}`;
    store.appendChronicle(scope, { turn: 35, kind: 'game-event', text: oversized });
    const snapshot = store.getSnapshot(scope);
    const message = buildCivilizationMemoryContext(parameters(store), 'strategic')!;
    expect(store.getAllChronicle(scope)[0]?.text).toBe(oversized);
    expect(snapshot.recentChronicleTokenCount).toBeLessThanOrEqual(RECENT_CHRONICLE_HARD_TOKEN_LIMIT);
    expect(snapshot.recentChronicleTruncated).toBe(true);
    expect(String(message.content)).toContain('truncated in working context');
    expect(String(message.content)).toContain('complete source remains stored in raw history');
    store.close();
  });

  it('runs maintenance once only after overflow and retriggers after later overflow', async () => {
    const store = openStore();
    const context = createFakeVoxContext('civilization-memory-maintenance');
    const scope = { gameId: 'game-memory-test', ownerPlayerId: 1, turn: 35 };
    const params = parameters(store);
    appendTokenBlock(store, scope, RECENT_CHRONICLE_SOFT_TOKEN_LIMIT - 500, 'below-soft');
    await runCivilizationMemoryMaintenance(context.asContext(), params);
    expect(context.execute).not.toHaveBeenCalled();

    appendTokenBlock(store, scope, 600, 'cross-soft');
    context.execute.mockImplementation(async (_agentName, input) => {
      const range = (input as { range: { entries: unknown[] } }).range;
      store.commitCompaction(scope, range as never, 'Compacted continuity from the oldest factual entries.');
    });
    await runCivilizationMemoryMaintenance(context.asContext(), params);
    expect(context.execute).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot(scope).maintenanceRequired).toBe(false);
    const longTermRevision = store.getLongTerm(scope)?.revision;
    const cursor = store.getLongTerm(scope)?.compactedThroughSequence;

    await runCivilizationMemoryMaintenance(context.asContext(), params);
    expect(context.execute).toHaveBeenCalledTimes(1);
    expect(store.getLongTerm(scope)?.revision).toBe(longTermRevision);
    expect(store.getLongTerm(scope)?.compactedThroughSequence).toBe(cursor);

    appendTokenBlock(store, scope, RECENT_CHRONICLE_SOFT_TOKEN_LIMIT, 'cross-soft-again');
    await runCivilizationMemoryMaintenance(context.asContext(), params);
    expect(context.execute).toHaveBeenCalledTimes(2);
    store.close();
  });

  it('leaves continuity unchanged when maintenance execution fails', async () => {
    const store = openStore();
    const context = createFakeVoxContext('civilization-memory-maintenance-failure');
    const scope = { gameId: 'game-memory-test', ownerPlayerId: 1, turn: 35 };
    const params = parameters(store);
    appendTokenBlock(store, scope, RECENT_CHRONICLE_SOFT_TOKEN_LIMIT + 1_000, 'overflow');
    context.execute.mockRejectedValue(new Error('provider unavailable'));
    await runCivilizationMemoryMaintenance(context.asContext(), params);
    expect(context.execute).toHaveBeenCalledTimes(1);
    expect(store.getLongTerm(scope)).toBeUndefined();
    expect(store.getAllChronicle(scope)).toHaveLength(1);
    expect(store.getSnapshot(scope).maintenanceRequired).toBe(true);
    store.close();
  });

  it('deduplicates factual source records without deleting them during compaction', () => {
    const store = openStore();
    const scope = { gameId: 'game-memory-test', ownerPlayerId: 1, turn: 35 };
    const entry = { turn: 35, kind: 'game-event' as const, text: 'Persia declared war on Greece.', dedupeKey: 'game-event:77:1', scope: 'game' as const };
    store.appendChronicle(scope, entry);
    store.appendChronicle(scope, entry);
    for (let index = 0; index < 24; index += 1) appendTokenBlock(store, { ...scope, turn: 36 + index }, 2_000, `Fact ${index}`);
    const range = store.selectCompactionRange(scope, { targetRemainingTokens: RECENT_CHRONICLE_TARGET_TOKEN_LIMIT, maxEntries: 10 })!;
    store.commitCompaction(scope, range, 'Persia declared war on Greece.');
    const facts = store.getAllChronicle(scope);
    expect(facts.filter(item => item.dedupeKey === entry.dedupeKey)).toHaveLength(1);
    expect(facts).toHaveLength(25);
    expect(store.getLongTerm(scope)?.compactedThroughSequence).toBe(10);
    store.close();
  });

  it('keeps private chronicle data owner-scoped and renders prose without storage identifiers', () => {
    const store = openStore();
    const rome = { gameId: 'game-memory-test', ownerPlayerId: 1, turn: 35 };
    const persia = { gameId: 'game-memory-test', ownerPlayerId: 3, turn: 35 };
    store.appendChronicle(rome, { turn: 35, kind: 'private-message', text: 'A private border discussion.', scope: 'private', participantPlayerIds: [1, 2], dedupeKey: 'private:1:1' });
    const snapshot = store.getSnapshot(persia);
    expect(snapshot.recentChronicle).toHaveLength(0);
    const message = buildCivilizationMemoryContext(parameters(store), 'strategic')!;
    expect(String(message.content)).toContain('A private border discussion.');
    expect(String(message.content)).not.toContain('ownerPlayerId');
    expect(String(message.content)).not.toContain('chronicle sequence');
    store.close();
  });

  it('retains a long-horizon outlook after recent history is compacted', () => {
    const store = openStore();
    const scope = { gameId: 'game-memory-test', ownerPlayerId: 1, turn: 35 };
    store.updateOutlook(scope, 'The river remains an informal boundary and ambiguity should be discussed before escalation.', 0, 'outlook-border');
    for (let index = 0; index < 15; index += 1) appendTokenBlock(store, { ...scope, turn: 35 + index }, 2_000, `Border history fact ${index}`);
    const range = store.selectCompactionRange(scope, { targetRemainingTokens: RECENT_CHRONICLE_TARGET_TOKEN_LIMIT, maxEntries: 100 })!;
    store.commitCompaction(scope, range, 'The river remains an informal boundary; later settlement facts were ambiguous.');
    const snapshot = store.getSnapshot(scope);
    expect(snapshot.outlook?.text).toContain('informal boundary');
    expect(snapshot.longTerm?.text).toContain('ambiguous');
    expect(snapshot.recentChronicle[0]?.text).toContain('Border history fact 8');
    store.close();
  });

  it('updates Outlook through one constrained model support tool without accepting an owner', async () => {
    const store = openStore();
    const context = createFakeVoxContext('civilization-memory-tool');
    const params = parameters(store);
    const tool = createCivilizationMemoryTools(context.asContext())['update-civilization-outlook']!;
    await context.withRun({ parameters: params }, async () => {
      await tool.execute!({ Outlook: 'We should avoid an immediate war with Greece.' }, { toolCallId: 'outlook-call-1', messages: [] });
      await tool.execute!({ Outlook: 'This retry must not overwrite the first outlook.' }, { toolCallId: 'outlook-call-1', messages: [] });
    });
    expect(store.getOutlook({ gameId: 'game-memory-test', ownerPlayerId: 1, turn: 35 })?.text).toContain('avoid an immediate war');
    store.close();
  });

});
