import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CivilizationMemoryStore } from '../../../src/civilization-memory/civilization-memory-store.js';
import { buildCivilizationMemoryContext } from '../../../src/civilization-memory/civilization-memory-context.js';
import type { StrategistParameters } from '../../../src/strategist/strategy-parameters.js';

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

  it('keeps outlook updates optimistic and retries idempotently', () => {
    const store = openStore();
    const scope = { gameId: 'game-memory-test', ownerPlayerId: 1, turn: 35 };
    const first = store.updateOutlook(scope, 'Initial outlook.', 0, 'same-operation');
    const replay = store.updateOutlook(scope, 'Different text must not replace a committed operation.', 0, 'same-operation');
    expect(replay).toEqual(first);
    expect(() => store.updateOutlook(scope, 'Stale replacement.', 0, 'new-operation')).toThrow(/changed during this wake/);
    store.close();
  });

  it('deduplicates factual source records without deleting them during compaction', () => {
    const store = openStore();
    const scope = { gameId: 'game-memory-test', ownerPlayerId: 1, turn: 35 };
    const entry = { turn: 35, kind: 'game-event' as const, text: 'Persia declared war on Greece.', dedupeKey: 'game-event:77:1', scope: 'game' as const };
    store.appendChronicle(scope, entry);
    store.appendChronicle(scope, entry);
    for (let index = 0; index < 24; index += 1) store.appendChronicle(scope, { turn: 36 + index, kind: 'self-note', text: `Fact ${index}` });
    const range = store.selectCompactionRange(scope, 10)!;
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
    for (let index = 0; index < 15; index += 1) store.appendChronicle(scope, { turn: 35 + index, kind: 'private-message', text: `Border history fact ${index}`, dedupeKey: `border:${index}`, scope: 'private', participantPlayerIds: [1, 2] });
    const range = store.selectCompactionRange(scope, 10)!;
    store.commitCompaction(scope, range, 'The river remains an informal boundary; later settlement facts were ambiguous.');
    const snapshot = store.getSnapshot(scope);
    expect(snapshot.outlook?.text).toContain('informal boundary');
    expect(snapshot.longTerm?.text).toContain('ambiguous');
    expect(snapshot.recentChronicle[0]?.text).toContain('Border history fact 10');
    store.close();
  });
});
