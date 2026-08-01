import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app } from '../../../src/index.js';
import { pauseManager } from '../../../src/services/pause-manager.js';
import { dllConnector } from '../../../src/services/dll-connector.js';
import bridgeService from '../../../src/service.js';
import { restoreSharedMockDLL, startIsolatedMockDLL } from '../../test-utils/isolated-mock.js';
import { MockDLLServer } from '../../test-utils/mock-dll-server.js';

describe('Pause Routes', () => {
  const sentMessages: any[] = [];
  let mockDLL: MockDLLServer;
  let originalPipeId: string;

  const captureHandler = (message: any) => {
    if (['pause_player', 'unpause_player', 'clear_paused_players'].includes(message.type)) {
      sentMessages.push(message);
    }
  };

  beforeAll(async () => {
    const isolated = await startIsolatedMockDLL('pause-routes');
    mockDLL = isolated.mockDLL;
    originalPipeId = isolated.originalPipeId;
    await bridgeService.start();
    dllConnector.on('ipc_send', captureHandler);
  });

  afterAll(async () => {
    dllConnector.off('ipc_send', captureHandler);
    await restoreSharedMockDLL(mockDLL, originalPipeId);
  });

  afterEach(() => {
    sentMessages.length = 0;
    pauseManager.finalize();
    vi.restoreAllMocks();
  });

  it('registers and unregisters paused players through the REST API', async () => {
    const registerResponse = await request(app).post('/external/pause-player/0').expect(200);
    expect(registerResponse.body.success).toBe(true);
    expect(registerResponse.body.result.pausedPlayers).toEqual([0]);

    const listResponse = await request(app).get('/external/paused-players').expect(200);
    expect(listResponse.body.success).toBe(true);
    expect(listResponse.body.result.pausedPlayers).toEqual([0]);
    expect(listResponse.body.result.isGamePaused).toBe(false);

    const unregisterResponse = await request(app).delete('/external/pause-player/0').expect(200);
    expect(unregisterResponse.body.success).toBe(true);
    expect(unregisterResponse.body.result.pausedPlayers).toEqual([]);

    expect(sentMessages).toEqual([
      { type: 'pause_player', playerID: 0 },
      { type: 'unpause_player', playerID: 0 }
    ]);
  });

  it('clears all paused players through the REST API', async () => {
    await request(app).post('/external/pause-player/0').expect(200);
    await request(app).post('/external/pause-player/63').expect(200);

    const clearResponse = await request(app).delete('/external/paused-players').expect(200);
    expect(clearResponse.body).toEqual({
      success: true,
      result: { pausedPlayers: [] }
    });

    expect(sentMessages.map(message => message.type)).toEqual([
      'pause_player',
      'pause_player',
      'clear_paused_players'
    ]);
  });

  it.each([
    { playerId: -1, expectedSuccess: false, expectedError: 'INVALID_ARGUMENTS' },
    { playerId: 0, expectedSuccess: true, expectedError: undefined },
    { playerId: 63, expectedSuccess: true, expectedError: undefined },
    { playerId: 64, expectedSuccess: false, expectedError: 'INVALID_ARGUMENTS' }
  ])('validates pause-player boundaries for $playerId', async ({ playerId, expectedSuccess, expectedError }) => {
    const registerResponse = await request(app).post(`/external/pause-player/${playerId}`).expect(200);
    expect(registerResponse.body.success).toBe(expectedSuccess);
    expect(registerResponse.body.error?.code).toBe(expectedError);

    const unregisterResponse = await request(app).delete(`/external/pause-player/${playerId}`).expect(200);
    expect(unregisterResponse.body.success).toBe(expectedSuccess);
    expect(unregisterResponse.body.error?.code).toBe(expectedError);
  });
});
