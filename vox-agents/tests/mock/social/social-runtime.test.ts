import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SocialRuntime } from '../../../src/social/runtime/social-runtime.js';
import { CivEnvironmentAdapter } from '../../../src/social/environments/civ/civ-environment-adapter.js';
import { attachCivEnvironment } from '../../../src/social/environments/civ/civ-social-attachment.js';
import { MemoryEnvironmentEventJournal } from '../../../src/social/environments/environment-event.js';
import type { CivMcpPort } from '../../../src/social/environments/civ/civ-mcp-port.js';

const runtimes: SocialRuntime[] = [];
const directories: string[] = [];

/** Create a disposable standalone social runtime. */
function createRuntime(): SocialRuntime {
  const runtime = new SocialRuntime();
  runtimes.push(runtime);
  return runtime;
}

/** Close runtimes and remove temporary session databases. */
afterEach(async () => { for (const runtime of runtimes.splice(0)) await runtime.stop(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe('SocialRuntime', () => {
  it('should run a human-only session without Civilization V and publish committed events', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vox-deorum-social-runtime-'));
    directories.push(directory);
    const runtime = createRuntime();
    const events: string[] = [];
    runtime.events.subscribe((event) => events.push(event.type));
    await runtime.start({ dataDirectory: directory, sessionId: 'sandbox-1', actors: [
      { id: 'human', ordinal: 0, control: 'human', displayName: 'Human' },
      { id: 'alice', ordinal: 1, control: 'model', displayName: 'Alice', modelRef: 'model-a' },
    ] });
    await runtime.appendHumanMessage('world', 'A public opening');
    const dm = await runtime.openHumanDm('alice');
    await runtime.appendHumanMessage(dm.id, 'A private greeting');
    expect((await runtime.listChannels()).map((channel) => channel.id)).toEqual(['world', dm.id]);
    expect(events).toEqual(['message-added', 'intention-created', 'channel-created', 'message-added', 'intention-created']);
  });

  it('should route a canonical MCP notification into one durable player-mind wake', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vox-deorum-social-runtime-civ-')); directories.push(directory); const runtime = createRuntime(); const events: string[] = []; runtime.events.subscribe((event) => events.push(event.type));
    const actors = [{ id: 'human', ordinal: 0, control: 'human' as const, displayName: 'Human' }, { id: 'alice', ordinal: 1, control: 'model' as const, displayName: 'Alice', modelRef: 'model-a' }]; await runtime.start({ dataDirectory: directory, sessionId: 'sandbox-civ', actors, modelExecutor: { decide: async () => ({ kind: 'pass' as const }) } });
    const listeners: Array<(event: never) => void> = []; const port: CivMcpPort = { getTools: async () => [], callTool: async () => ({ structuredContent: {} }), onNotification: (handler) => { listeners.push(handler as never); return () => undefined; } }; const adapter = new CivEnvironmentAdapter(new MemoryEnvironmentEventJournal()); await attachCivEnvironment(runtime, adapter, { environment: 'civ5', gameId: 'game-1', turn: 1, facts: {}, seats: [{ playerId: 4, civilizationType: 'CIVILIZATION_HUMAN', civilizationName: 'Human', human: true }, { playerId: 9, civilizationType: 'CIVILIZATION_ALICE', civilizationName: 'Alice' }], normalizedState: { era: 'Ancient' } }, { human: 4, alice: 9 }, port); listeners[0]?.({ event: 'CityFounded', playerID: 9, turn: 1, latestID: 10, gameID: 'game-1', PlayerID: 9, Turn: 1, data: { cityId: 3 } } as never); await new Promise((resolve) => setTimeout(resolve, 50)); expect(events).toContain('intention-created');
  });
});
