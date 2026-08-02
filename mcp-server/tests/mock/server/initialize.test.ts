/** Tests for MCPServer initialization boundaries. */

import { afterEach, describe, expect, it, vi } from 'vitest';

// Replace the promise-based sleep with an immediate fake so all twenty retry
// attempts are exercised without waiting for wall-clock time.
const retrySleep = vi.hoisted(() => vi.fn<() => Promise<void>>());
vi.mock('node:timers/promises', () => ({
  setTimeout: retrySleep,
}));

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  retrySleep.mockReset();
  vi.resetModules();
});

describe('MCPServer.initialize bridge health retry', () => {
  it('retries the bridge health check twenty times before preserving the connection error', async () => {
    vi.useFakeTimers();
    vi.resetModules();
    retrySleep.mockResolvedValue();
    const { DatabaseManager } = await import('../../../src/database/manager.js');
    const { KnowledgeManager } = await import('../../../src/knowledge/manager.js');
    const { BridgeManager } = await import('../../../src/bridge/manager.js');
    vi.spyOn(DatabaseManager.prototype, 'initialize').mockResolvedValue();
    vi.spyOn(KnowledgeManager.prototype, 'initialize').mockResolvedValue();
    vi.spyOn(BridgeManager.prototype as any, 'startQueueProcessorLoop').mockImplementation(() => undefined);
    const checkHealth = vi.spyOn(BridgeManager.prototype, 'checkHealth').mockRejectedValue(new Error('bridge unavailable'));
    vi.spyOn(BridgeManager.prototype, 'shutdown').mockResolvedValue();
    const { MCPServer } = await import('../../../src/server.js');
    const server = MCPServer.getInstance();

    const initialization = server.initialize();

    await expect(initialization).rejects.toThrow('Failed to connect to Bridge Service: bridge unavailable');
    expect(checkHealth).toHaveBeenCalledTimes(20);
    expect(retrySleep).toHaveBeenCalledTimes(19);
    expect(retrySleep).toHaveBeenCalledWith(3_000);
    await server.close();
  });
});
