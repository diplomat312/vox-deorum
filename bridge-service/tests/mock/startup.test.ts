/**
 * Bridge HTTP startup lifecycle tests.
 *
 * The shutdown endpoint must be available before IPC initialization starts so
 * the service manager can always stop a Bridge that stalls on a named pipe.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

/** Create a promise whose completion is controlled by the test. */
function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

/** Read the shutdown URL after the listener publishes its dynamic port. */
async function readPublishedShutdownUrl(filePath: string): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      return (await readFile(filePath, 'utf8')).trim();
    } catch {
      await setTimeout(10);
    }
  }

  throw new Error('Bridge Service did not publish its shutdown URL');
}

const originalShutdownUrlFile = process.env.BRIDGE_SHUTDOWN_URL_FILE;
const trackedEvents = ['SIGTERM', 'SIGBREAK', 'SIGINT', 'uncaughtException', 'unhandledRejection'] as const;
const originalProcessListeners = new Map(
  trackedEvents.map((event) => [event, new Set(process.listeners(event))]),
);

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();

  if (originalShutdownUrlFile === undefined) {
    delete process.env.BRIDGE_SHUTDOWN_URL_FILE;
  } else {
    process.env.BRIDGE_SHUTDOWN_URL_FILE = originalShutdownUrlFile;
  }

  for (const event of trackedEvents) {
    const originalListeners = originalProcessListeners.get(event)!;
    for (const listener of process.listeners(event)) {
      if (!originalListeners.has(listener)) {
        process.removeListener(event, listener as never);
      }
    }
  }
});

describe('Bridge HTTP startup lifecycle', () => {
  it('publishes its shutdown URL before IPC initialization starts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'bridge-http-startup-'));
    const shutdownFile = join(directory, 'shutdown-url.txt');
    process.env.BRIDGE_SHUTDOWN_URL_FILE = shutdownFile;
    vi.resetModules();

    const { config } = await import('../../src/utils/config.js');
    config.rest.host = '127.0.0.1';
    config.rest.port = 0;
    const { BridgeService } = await import('../../src/service.js');
    const deferred = createDeferred();
    let shutdownFileAtIpcStart = '';
    vi.spyOn(BridgeService.prototype, 'start').mockImplementation(async () => {
      shutdownFileAtIpcStart = await readFile(shutdownFile, 'utf8');
      return deferred.promise;
    });
    const shutdownSpy = vi.spyOn(BridgeService.prototype, 'shutdown').mockResolvedValue();
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const { startServer } = await import('../../src/index.js');

    const startPromise = startServer();
    let shutdownUrl: string | undefined;
    try {
      shutdownUrl = await readPublishedShutdownUrl(shutdownFile);
      await vi.waitFor(() => expect(shutdownFileAtIpcStart.trim()).toBe(shutdownUrl));

      const healthResponse = await fetch(shutdownUrl.replace('/shutdown', '/health'));
      expect(healthResponse.status).toBe(200);

      const shutdownResponse = await fetch(shutdownUrl, { method: 'POST' });
      expect(shutdownResponse.status).toBe(202);
      await vi.waitFor(() => expect(shutdownSpy).toHaveBeenCalledOnce());
      await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0));
    } finally {
      if (shutdownUrl && !exitSpy.mock.calls.length) {
        await fetch(shutdownUrl, { method: 'POST' }).catch(() => undefined);
      }
      deferred.resolve();
      await startPromise;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
