/**
 * HTTP startup lifecycle tests.
 *
 * These tests keep initialization pending while a real ephemeral HTTP listener
 * serves readiness and shutdown endpoints. The shutdown URL environment value
 * must be set before importing http.ts because that module captures it once.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Agent, createServer, get } from 'node:http';
import { once } from 'node:events';
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

/** Resolve initialization and close a server that a lifecycle test started. */
async function stopStartedServer(
  deferred: { resolve: () => void },
  startPromise: Promise<() => Promise<void>>,
): Promise<void> {
  deferred.resolve();
  const shutdown = await startPromise;
  await shutdown();
}

/** Read the shutdown URL after the listener has published its dynamic port. */
async function readPublishedShutdownUrl(filePath: string): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      return (await readFile(filePath, 'utf8')).trim();
    } catch {
      await setTimeout(10);
    }
  }

  throw new Error('MCP server did not publish its shutdown URL');
}

/** Fetch an endpoint and retain its keep-alive socket for shutdown assertions. */
async function openKeepAliveHealthConnection(url: string): Promise<import('node:net').Socket> {
  return new Promise((resolve, reject) => {
    const request = get(url, { agent: new Agent({ keepAlive: true }) }, (response) => {
      response.resume();
      response.once('end', () => resolve(request.socket));
    });
    request.once('error', reject);
  });
}

const originalShutdownUrlFile = process.env.MCP_SHUTDOWN_URL_FILE;

afterEach(async () => {
  vi.restoreAllMocks();
  vi.resetModules();

  if (originalShutdownUrlFile === undefined) {
    delete process.env.MCP_SHUTDOWN_URL_FILE;
  } else {
    process.env.MCP_SHUTDOWN_URL_FILE = originalShutdownUrlFile;
  }
});

describe('HTTP startup lifecycle', () => {
  it('publishes a shutdown URL and reports initialization while MCP traffic waits', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcp-http-startup-'));
    const shutdownFile = join(directory, 'shutdown-url.txt');
    process.env.MCP_SHUTDOWN_URL_FILE = shutdownFile;
    vi.resetModules();

    const { config } = await import('../../../src/utils/config.js');
    config.transport.host = '127.0.0.1';
    config.transport.port = 0;
    const { MCPServer } = await import('../../../src/server.js');
    const deferred = createDeferred();
    vi.spyOn(MCPServer.prototype, 'initialize').mockImplementation(() => deferred.promise);
    vi.spyOn(MCPServer.prototype, 'close').mockResolvedValue();
    const { startHttpServer } = await import('../../../src/http.js');

    const startPromise = startHttpServer(false);
    try {
      const shutdownUrl = await readPublishedShutdownUrl(shutdownFile);
      const baseUrl = shutdownUrl.replace('/shutdown', '');

      const healthResponse = await fetch(`${baseUrl}/health`);
      expect(healthResponse.status).toBe(200);
      await expect(healthResponse.json()).resolves.toMatchObject({ status: 'initializing' });

      for (const method of ['GET', 'POST', 'DELETE']) {
        const response = await fetch(`${baseUrl}/mcp`, {
          method,
          headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
          body: method === 'POST' ? JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }) : undefined,
        });
        expect(response.status).toBe(503);
        expect(response.headers.get('retry-after')).toBe('2');
        await expect(response.json()).resolves.toMatchObject({
          jsonrpc: '2.0',
          error: { code: -32001 },
          id: null,
        });
      }
    } finally {
      try {
        await stopStartedServer(deferred, startPromise);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  it('accepts an SDK client after initialization completes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcp-http-ready-'));
    const shutdownFile = join(directory, 'shutdown-url.txt');
    process.env.MCP_SHUTDOWN_URL_FILE = shutdownFile;
    vi.resetModules();

    const { config } = await import('../../../src/utils/config.js');
    config.transport.host = '127.0.0.1';
    config.transport.port = 0;
    const { MCPServer } = await import('../../../src/server.js');
    const deferred = createDeferred();
    vi.spyOn(MCPServer.prototype, 'initialize').mockImplementation(() => deferred.promise);
    vi.spyOn(MCPServer.prototype, 'close').mockResolvedValue();
    const { startHttpServer } = await import('../../../src/http.js');

    const startPromise = startHttpServer(false);
    let client: Client | undefined;

    try {
      const shutdownUrl = await readPublishedShutdownUrl(shutdownFile);
      deferred.resolve();
      await startPromise;
      client = new Client({ name: 'startup-test-client', version: '1.0.0' });

      await client.connect(new StreamableHTTPClientTransport(new URL(shutdownUrl.replace('/shutdown', '/mcp'))));
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain('calculator');
    } finally {
      try {
        try {
          await client?.close();
        } finally {
          await stopStartedServer(deferred, startPromise);
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  it('closes keep-alive connections when shutdown arrives during initialization', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mcp-http-shutdown-'));
    const shutdownFile = join(directory, 'shutdown-url.txt');
    process.env.MCP_SHUTDOWN_URL_FILE = shutdownFile;
    vi.resetModules();

    const { config } = await import('../../../src/utils/config.js');
    config.transport.host = '127.0.0.1';
    config.transport.port = 0;
    const { MCPServer } = await import('../../../src/server.js');
    const deferred = createDeferred();
    vi.spyOn(MCPServer.prototype, 'initialize').mockImplementation(() => deferred.promise);
    const closeSpy = vi.spyOn(MCPServer.prototype, 'close').mockResolvedValue();
    const { startHttpServer } = await import('../../../src/http.js');

    const startPromise = startHttpServer(false);
    let socket: import('node:net').Socket | undefined;

    try {
      const shutdownUrl = await readPublishedShutdownUrl(shutdownFile);
      socket = await openKeepAliveHealthConnection(shutdownUrl.replace('/shutdown', '/health'));
      expect(socket.destroyed).toBe(false);

      const socketClosed = once(socket, 'close');
      const response = await fetch(shutdownUrl, { method: 'POST' });
      expect(response.status).toBe(202);
      await Promise.race([
        socketClosed,
        setTimeout(1_000).then(() => {
          throw new Error('Shutdown left a keep-alive connection open');
        }),
      ]);
      await vi.waitFor(() => expect(closeSpy).toHaveBeenCalledOnce());
    } finally {
      try {
        socket?.destroy();
        await stopStartedServer(deferred, startPromise);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });

  it('reports an orphaned mcp-server when the address is already in use', async () => {
    const holder = createServer();
    await new Promise<void>((resolve) => holder.listen(0, '127.0.0.1', resolve));
    const address = holder.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    vi.resetModules();

    const { config } = await import('../../../src/utils/config.js');
    config.transport.host = '127.0.0.1';
    config.transport.port = port;
    const { MCPServer } = await import('../../../src/server.js');
    vi.spyOn(MCPServer.prototype, 'initialize').mockResolvedValue();
    const { startHttpServer } = await import('../../../src/http.js');

    try {
      await expect(startHttpServer(false)).rejects.toThrow('likely an orphaned mcp-server');
    } finally {
      await new Promise<void>((resolve, reject) => holder.close((error) => error ? reject(error) : resolve()));
    }
  });
});
