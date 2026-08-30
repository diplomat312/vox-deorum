import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SocialRuntime } from '../../../src/social/runtime/social-runtime.js';

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
});
