import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PoliticalMemoryStore } from '../../../src/political-memory/political-memory-store.js';
import type { PoliticalMemoryScope } from '../../../src/political-memory/types.js';
import { createPoliticalMemoryTools } from '../../../src/political-memory/political-memory-tools.js';
import { createFakeVoxContext, makeStrategistParameters } from '../../helpers/fake-vox-context.js';

const directories: string[] = [];

/** Create a temporary database path isolated from repository runtime data. */
function temporaryPath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'vox-deorum-political-memory-'));
  directories.push(directory);
  return join(directory, 'memory.sqlite');
}

/** Build a deterministic game and civilization scope for a memory test. */
function testScope(ownerPlayerId = 1, turn = 35): PoliticalMemoryScope {
  return { gameId: 'game-memory-test', ownerPlayerId, turn };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('PoliticalMemoryStore', () => {
  it('persists a long-horizon commitment across close and reopen', () => {
    const path = temporaryPath();
    const first = new PoliticalMemoryStore(path);
    const scope = testScope();
    const commitment = first.recordCommitment(scope, { parties: [2], kind: 'informal-agreement', summary: 'Rome avoids settling north of the river.', visibility: 'private' }, 'commitment-call-1');
    first.close();

    const reopened = new PoliticalMemoryStore(path);
    expect(reopened.getSnapshot(scope.gameId, scope.ownerPlayerId, 80).commitments).toEqual([commitment]);
    reopened.close();
  });

  it('makes repeated tool mutations idempotent and preserves lifecycle history', () => {
    const store = new PoliticalMemoryStore(temporaryPath());
    const scope = testScope();
    const goal = store.createGoal(scope, { title: 'Repair relationship with Greece', priority: 'high' }, 'goal-call-1');
    expect(store.createGoal(scope, { title: 'different replay payload', priority: 'low' }, 'goal-call-1')).toEqual(goal);
    const relationship = store.adjustRelationship(scope, { counterpartPlayerId: 2, dimension: 'trust', direction: 'decrease', magnitude: 'moderate', reason: 'Border agreement broken' }, 'relationship-call-1');
    expect(store.adjustRelationship(scope, { counterpartPlayerId: 2, dimension: 'trust', direction: 'decrease', magnitude: 'major' }, 'relationship-call-1')).toEqual(relationship);
    const resolved = store.resolveGoal({ ...scope, turn: 80 }, goal.id, 'abandoned', 'goal-resolve-1');

    expect(store.getSnapshot(scope.gameId, scope.ownerPlayerId, 80).goals).toEqual([resolved]);
    expect(store.getSnapshot(scope.gameId, scope.ownerPlayerId, 80).relationships[0].trust).toBe(35);
    store.close();
  });

  it('keeps subjective memory private to its owner civilization', () => {
    const store = new PoliticalMemoryStore(temporaryPath());
    const rome = testScope(1);
    const greece = testScope(2);
    store.recordCommitment(rome, { parties: [2], kind: 'promise', summary: 'Private border understanding', visibility: 'private' }, 'rome-call-1');
    store.rememberEpisode(rome, { importance: 'critical', summary: 'Rome and Greece settled a border dispute.', counterpartPlayerIds: [2] }, 'rome-call-2');

    expect(store.getSnapshot(rome.gameId, rome.ownerPlayerId, 80).commitments).toHaveLength(1);
    expect(store.getSnapshot(greece.gameId, greece.ownerPlayerId, 80).commitments).toHaveLength(0);
    expect(store.getSnapshot(greece.gameId, greece.ownerPlayerId, 80).episodes).toHaveLength(0);
    store.close();
  });

  it('supports beliefs, projects, episodes, and counterpart-focused retrieval', () => {
    const store = new PoliticalMemoryStore(temporaryPath());
    const scope = testScope();
    store.upsertBelief(scope, { subject: 'Player 2', claim: 'May prepare a surprise war', confidence: 'medium' }, 'belief-call-1');
    const project = store.createProject(scope, { title: 'Build an anti-Persia coalition', counterpartPlayerIds: [2], priority: 'high' }, 'project-call-1');
    store.rememberEpisode(scope, { importance: 'high', summary: 'Greece rescued Rome during an invasion.', counterpartPlayerIds: [2] }, 'episode-call-1');

    const focused = store.getRelevantMemory({ ...scope, turn: 80 }, 2);
    expect(focused.projects).toEqual([project]);
    expect(focused.episodes[0].summary).toContain('rescued');
    expect(focused.beliefs[0].claim).toContain('surprise war');
    store.close();
  });

  it('keeps retry safety at the model tool boundary and never lets the model choose the owner', async () => {
    const store = new PoliticalMemoryStore(temporaryPath());
    const context = createFakeVoxContext('political-memory-tools');
    const parameters = makeStrategistParameters({ politicalMemoryStore: store });
    const tools = createPoliticalMemoryTools(context.asContext());

    await context.withRun({ parameters }, async () => {
      const args = { Parties: [2], Kind: 'promise', Summary: 'Support the northern border', Visibility: 'private' };
      await tools['record-commitment'].execute!(args, { toolCallId: 'same-tool-call', messages: [] });
      await tools['record-commitment'].execute!(args, { toolCallId: 'same-tool-call', messages: [] });
    });

    expect(store.getSnapshot('test-game', 1, 5).commitments).toHaveLength(1);
    expect(store.getSnapshot('test-game', 2, 5).commitments).toHaveLength(0);
    store.close();
  });
});
