/**
 * @module tests/mock/web/server
 *
 * Supertest coverage for the complete web server. The shared MCP client mock keeps
 * the test in-process while preserving the same route wiring used in production.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';

// Replace the singleton imported by web route modules with the shared MCP mock.
vi.mock('../../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

import { app } from '../../../src/web/server.js';
import config from '../../../src/utils/config.js';
import { installMockMcpClient } from '../../helpers/mock-mcp-client.js';

describe('web server', () => {
  beforeEach(() => {
    installMockMcpClient();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('serves health with the current release version', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.service).toBe('vox-agents-webui');
    expect(response.body.timestamp).toEqual(expect.any(String));
    expect(response.body.version).toBe(config.versionInfo?.version ?? '0.0.0');
  });

  it('reports an idle session exactly when no session is active', async () => {
    const response = await request(app).get('/api/session/status');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ active: false });
  });

  it('returns an error when players-summary has no active session', async () => {
    const response = await request(app).get('/api/session/players-summary');

    expect(response.status).toBe(404);
    expect(response.body.error).toEqual(expect.any(String));
  });

  it('returns JSON 404 for an unknown API endpoint', async () => {
    const response = await request(app).get('/api/not-a-route');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'API endpoint not found' });
  });

  it('uses the SPA fallback when the UI has not been built', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    const response = await request(app).get('/session/123');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: 'UI not built',
      details: 'Run "npm run build" in ui/ directory to build the frontend',
    });
  });
});
