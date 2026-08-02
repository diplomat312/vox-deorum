/**
 * @module tests/mock/web/routes
 *
 * Supertest coverage for the config and session route modules — the two the plan
 * prioritizes (agent/telemetry have heavier coupling and live in their own files).
 *
 * The routers are mounted on a bare Express app, exactly as `web/server.ts` mounts them.
 * Filesystem access is spied per-test (the route modules `import fs from 'fs/promises'`,
 * so spying the namespace methods intercepts their calls without disturbing the dozens of
 * transitive modules that also use fs at import time). `runStrategistLoop` is mocked so
 * POST /start never spawns a real game loop, and the MCP client uses the shared mock.
 */

import { afterEach, describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'fs/promises';

// Never spawn a real strategist loop when POST /api/session/start runs.
vi.mock('../../../../src/strategist/loop.js', () => ({
  runStrategistLoop: vi.fn(async () => {}),
}));

// Partial-mock the config util so we can drive loadVoxConfig/refreshConfig/getConfigsDir
// while leaving the default `config` export and everything else intact (many transitive
// modules depend on it).
vi.mock('../../../../src/utils/config.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/utils/config.js')>();
  return {
    ...actual,
    loadVoxConfig: vi.fn(actual.loadVoxConfig),
    refreshConfig: vi.fn(() => actual.refreshConfig?.()),
    getConfigsDir: vi.fn(() => '/fake/configs'),
  };
});

const routeMocks = vi.hoisted(() => ({
  discoverModels: vi.fn(),
  ensureCodexProxy: vi.fn(),
  proxy: { state: 'stopped', loginPrompt: undefined as unknown },
}));

vi.mock('../../../../src/utils/models/discovery.js', () => {
  class DiscoveryError extends Error {
    constructor(public readonly kind: string, public readonly status: number, message: string) {
      super(message);
    }
  }
  return { discoverModels: routeMocks.discoverModels, DiscoveryError };
});

vi.mock('../../../../src/utils/models/providers/codex-proxy.js', () => ({
  codexProxyManager: routeMocks.proxy,
  ensureCodexProxy: routeMocks.ensureCodexProxy,
}));

// Replace the MCP client singleton with the shared mock (used by players-summary).
vi.mock('../../../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

import configRoutes from '../../../../src/web/routes/config.js';
import sessionRoutes from '../../../../src/web/routes/session.js';
import { loadVoxConfig, refreshConfig, getConfigsDir } from '../../../../src/utils/config.js';
import { runStrategistLoop } from '../../../../src/strategist/loop.js';
import { sessionRegistry } from '../../../../src/infra/session-registry.js';
import { installMockMcpClient, structuredResult } from '../../../helpers/mock-mcp-client.js';
import { defaultConfig } from '../../../../src/utils/config/defaults.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/config', configRoutes);
  app.use('/api/session', sessionRoutes);
  return app;
}

const app = makeApp();

beforeEach(() => {
  vi.restoreAllMocks();
  installMockMcpClient();
  (getConfigsDir as Mock).mockReturnValue('/fake/configs');
  (refreshConfig as Mock).mockImplementation(() => {});
  (loadVoxConfig as Mock).mockReturnValue({ llms: { default: defaultConfig.llms.default } });
  routeMocks.discoverModels.mockReset();
  routeMocks.ensureCodexProxy.mockReset().mockResolvedValue(undefined);
  routeMocks.proxy.state = 'stopped';
  routeMocks.proxy.loginPrompt = undefined;
  for (const key of [
    'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY',
    'OPENROUTER_API_KEY', 'CHUTES_API_KEY', 'SYNTHETIC_API_KEY', 'OPENAI_COMPATIBLE_URL',
  ]) vi.stubEnv(key, '');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('config routes', () => {
  describe('GET /api/config', () => {
    it('returns merged config plus parsed .env keys', async () => {
      (loadVoxConfig as Mock).mockReturnValue({ agent: { name: 'vox' } });
      vi.spyOn(fs, 'readFile').mockResolvedValue('OPENAI_API_KEY=sk-test\nFOO=bar' as never);

      const res = await request(app).get('/api/config');

      expect(res.status).toBe(200);
      expect(res.body.config).toEqual({ agent: { name: 'vox' } });
      expect(res.body.apiKeys).toEqual({ OPENAI_API_KEY: 'sk-test', FOO: 'bar' });
    });

    it('still returns 200 with empty apiKeys when .env is missing', async () => {
      (loadVoxConfig as Mock).mockReturnValue({ agent: { name: 'vox' } });
      vi.spyOn(fs, 'readFile').mockRejectedValue(new Error('ENOENT'));

      const res = await request(app).get('/api/config');

      expect(res.status).toBe(200);
      expect(res.body.apiKeys).toEqual({});
    });

    it('rejects a foreign origin before reading API keys', async () => {
      const readFile = vi.spyOn(fs, 'readFile').mockResolvedValue('OPENAI_API_KEY=sk-test' as never);

      const res = await request(app)
        .get('/api/config')
        .set('Host', '127.0.0.1:3000')
        .set('Origin', 'https://attacker.test');

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'This browser origin is not allowed to read configuration.' });
      expect(readFile).not.toHaveBeenCalled();
      expect(res.text).not.toContain('sk-test');
    });

    it('rejects a DNS-rebinding host when the browser omits Origin', async () => {
      const readFile = vi.spyOn(fs, 'readFile').mockResolvedValue('OPENAI_API_KEY=sk-test' as never);

      const res = await request(app)
        .get('/api/config')
        .set('Host', 'dashboard.test:3000');

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'This browser origin is not allowed to read configuration.' });
      expect(readFile).not.toHaveBeenCalled();
      expect(res.text).not.toContain('sk-test');
    });

    it('allows a loopback browser origin on a different dashboard port', async () => {
      vi.spyOn(fs, 'readFile').mockResolvedValue('OPENAI_API_KEY=sk-test' as never);

      const res = await request(app)
        .get('/api/config')
        .set('Host', '127.0.0.1:3000')
        .set('Origin', 'http://localhost:5173');

      expect(res.status).toBe(200);
      expect(res.body.apiKeys).toEqual({ OPENAI_API_KEY: 'sk-test' });
    });

    it('returns 500 when the config cannot be loaded', async () => {
      (loadVoxConfig as Mock).mockImplementation(() => {
        throw new Error('parse error');
      });

      const res = await request(app).get('/api/config');

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/config/check', () => {
    it('reports unconfigured when no required credential or changed default is present', async () => {
      const res = await request(app).get('/api/config/check');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ configured: false });
    });

    it('reports configured for a required credential or changed default', async () => {
      vi.stubEnv('OPENAI_API_KEY', 'configured-key');
      await expect(request(app).get('/api/config/check')).resolves.toMatchObject({ body: { configured: true } });

      vi.unstubAllEnvs();
      (loadVoxConfig as Mock).mockReturnValue({ llms: { default: 'openai-compatible/MiniMax-M3' } });
      await expect(request(app).get('/api/config/check')).resolves.toMatchObject({ body: { configured: true } });
    });
  });

  describe('POST /api/config/models', () => {
    it('returns discovered models using request credentials', async () => {
      routeMocks.discoverModels.mockResolvedValue([{ id: 'openai/gpt-test', name: 'gpt-test' }]);

      const res = await request(app).post('/api/config/models').send({
        provider: 'openai', credentials: { OPENAI_API_KEY: 'request-key' },
      });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ provider: 'openai', models: [{ id: 'openai/gpt-test', name: 'gpt-test' }] });
      expect(routeMocks.discoverModels).toHaveBeenCalledWith('openai', { OPENAI_API_KEY: 'request-key' });
    });

    it('returns server-selected tier recommendations only when the catalog matches a rule', async () => {
      routeMocks.discoverModels.mockResolvedValue([
        { id: 'codex/gpt-5.6-terra', name: 'gpt-5.6-terra' },
        { id: 'codex/gpt-5.6-luna', name: 'gpt-5.6-luna' },
      ]);

      const matched = await request(app).post('/api/config/models').send({ provider: 'codex' });

      expect(matched.status).toBe(200);
      expect(matched.body).toMatchObject({
        provider: 'codex',
        recommendedTiers: { default: 'codex/gpt-5.6-terra', small: 'codex/gpt-5.6-luna' },
      });

      routeMocks.discoverModels.mockResolvedValue([{ id: 'openai/gpt-test', name: 'gpt-test' }]);
      const unmatched = await request(app).post('/api/config/models').send({ provider: 'openai' });

      expect(unmatched.status).toBe(200);
      expect(unmatched.body).not.toHaveProperty('recommendedTiers');
    });

    it('rejects a DNS-rebinding browser request before discovering models', async () => {
      routeMocks.discoverModels.mockResolvedValue([]);

      const res = await request(app)
        .post('/api/config/models')
        .set('Host', 'dashboard.test:3000')
        .set('Origin', 'http://dashboard.test:3000')
        .send({ provider: 'openai' });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'This browser origin is not allowed to discover models.', kind: 'unsupported' });
      expect(routeMocks.discoverModels).not.toHaveBeenCalled();
    });

    it('allows a loopback Vite origin when the API uses a loopback host', async () => {
      routeMocks.discoverModels.mockResolvedValue([]);

      const res = await request(app)
        .post('/api/config/models')
        .set('Host', '127.0.0.1:3000')
        .set('Origin', 'http://localhost:5173')
        .send({ provider: 'openai' });

      expect(res.status).toBe(200);
      expect(routeMocks.discoverModels).toHaveBeenCalledOnce();
    });

    it.each(['https://attacker.test', 'not an origin'])('rejects a disallowed browser origin', async (origin) => {
      const res = await request(app)
        .post('/api/config/models')
        .set('Host', 'dashboard.test:3000')
        .set('Origin', origin)
        .send({ provider: 'openai' });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'This browser origin is not allowed to discover models.', kind: 'unsupported' });
      expect(routeMocks.discoverModels).not.toHaveBeenCalled();
    });

    it('returns classified discovery failures', async () => {
      const { DiscoveryError } = await import('../../../../src/utils/models/discovery.js');
      routeMocks.discoverModels.mockRejectedValue(new DiscoveryError('missing-credential', 400, 'OpenAI requires OPENAI_API_KEY.'));

      const res = await request(app).post('/api/config/models').send({ provider: 'openai' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'OpenAI requires OPENAI_API_KEY.', kind: 'missing-credential' });
    });

    it('rejects malformed discovery requests before contacting a provider', async () => {
      const res = await request(app).post('/api/config/models').send({ credentials: { OPENAI_API_KEY: 12 } });

      expect(res.status).toBe(400);
      expect(res.body.kind).toBe('unsupported');
      expect(routeMocks.discoverModels).not.toHaveBeenCalled();
    });
  });

  describe('Codex setup routes', () => {
    it('starts login without waiting and returns the current state', async () => {
      routeMocks.proxy.state = 'starting';
      const res = await request(app).post('/api/config/codex/login');

      expect(res.status).toBe(202);
      expect(res.body).toEqual({ state: 'starting' });
      expect(routeMocks.ensureCodexProxy).toHaveBeenCalledOnce();
    });

    it('rejects a foreign origin before starting Codex sign-in', async () => {
      const res = await request(app)
        .post('/api/config/codex/login')
        .set('Host', 'dashboard.test:3000')
        .set('Origin', 'https://attacker.test');

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'This browser origin is not allowed to start Codex sign-in.' });
      expect(routeMocks.ensureCodexProxy).not.toHaveBeenCalled();
    });

    it('allows a loopback browser origin to start Codex sign-in', async () => {
      const res = await request(app)
        .post('/api/config/codex/login')
        .set('Host', '127.0.0.1:3000')
        .set('Origin', 'http://localhost:5173');

      expect(res.status).toBe(202);
      expect(routeMocks.ensureCodexProxy).toHaveBeenCalledOnce();
    });

    it('reports the non-secret login prompt and latest startup error', async () => {
      routeMocks.proxy.state = 'starting';
      routeMocks.proxy.loginPrompt = { verificationUrl: 'https://auth.openai.com/device', userCode: 'ABCD-1234' };
      routeMocks.ensureCodexProxy.mockRejectedValue(new Error('Login unavailable'));
      await request(app).post('/api/config/codex/login');
      await new Promise((resolve) => setImmediate(resolve));

      const res = await request(app).get('/api/config/codex/status');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        state: 'starting',
        login: { verificationUrl: 'https://auth.openai.com/device', userCode: 'ABCD-1234' },
        error: 'Login unavailable',
      });
    });

    it('rejects a foreign origin before returning the Codex sign-in prompt', async () => {
      routeMocks.proxy.loginPrompt = { verificationUrl: 'https://auth.openai.com/device', userCode: 'SECRET-CODE' };

      const res = await request(app)
        .get('/api/config/codex/status')
        .set('Host', 'dashboard.test:3000')
        .set('Origin', 'https://attacker.test');

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'This browser origin is not allowed to read Codex sign-in status.' });
      expect(res.body).not.toHaveProperty('login');
      expect(res.text).not.toContain('SECRET-CODE');
    });

    it('rejects a DNS-rebinding host before returning Codex sign-in status', async () => {
      routeMocks.proxy.loginPrompt = { verificationUrl: 'https://auth.openai.com/device', userCode: 'SECRET-CODE' };

      const res = await request(app)
        .get('/api/config/codex/status')
        .set('Host', 'dashboard.test:3000');

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'This browser origin is not allowed to read Codex sign-in status.' });
      expect(res.body).not.toHaveProperty('login');
      expect(res.text).not.toContain('SECRET-CODE');
    });

    it('allows a loopback browser origin to read Codex sign-in status', async () => {
      routeMocks.proxy.state = 'starting';
      routeMocks.proxy.loginPrompt = { verificationUrl: 'https://auth.openai.com/device', userCode: 'LOCAL-CODE' };

      const res = await request(app)
        .get('/api/config/codex/status')
        .set('Host', '127.0.0.1:3000')
        .set('Origin', 'http://localhost:5173');

      expect(res.status).toBe(200);
      expect(res.body.login).toEqual({ verificationUrl: 'https://auth.openai.com/device', userCode: 'LOCAL-CODE' });
    });
  });

  describe('POST /api/config', () => {
    it('writes the config diff and refreshes when config is provided', async () => {
      const writeFile = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined as never);

      const res = await request(app)
        .post('/api/config')
        .send({ config: { agent: { name: 'changed' }, llms: {} } });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      expect(writeFile).toHaveBeenCalled();
      const [target] = writeFile.mock.calls[0];
      expect(String(target)).toContain('config.json');
      expect(refreshConfig).toHaveBeenCalled();
    });

    it('merges and writes .env keys when apiKeys are provided', async () => {
      vi.spyOn(fs, 'readFile').mockResolvedValue('EXISTING=old' as never);
      const writeFile = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined as never);

      const res = await request(app)
        .post('/api/config')
        .send({ apiKeys: { NEW_KEY: 'value' } });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true });
      const envWrite = writeFile.mock.calls.find(([p]) => String(p).endsWith('.env'));
      expect(envWrite).toBeDefined();
      const written = String(envWrite![1]);
      expect(written).toContain('EXISTING=old');
      expect(written).toContain('NEW_KEY=value');
    });

    it('rejects a foreign origin before writing or refreshing configuration', async () => {
      const writeFile = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined as never);

      const res = await request(app)
        .post('/api/config')
        .set('Host', '127.0.0.1:3000')
        .set('Origin', 'https://attacker.test')
        .send({ apiKeys: { OPENAI_API_KEY: 'new-key' }, config: { agent: { name: 'changed' }, llms: {} } });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ error: 'This browser origin is not allowed to update configuration.' });
      expect(writeFile).not.toHaveBeenCalled();
      expect(refreshConfig).not.toHaveBeenCalled();
    });

    it('allows a loopback browser origin on a different dashboard port', async () => {
      const writeFile = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined as never);

      const res = await request(app)
        .post('/api/config')
        .set('Host', '127.0.0.1:3000')
        .set('Origin', 'http://localhost:5173')
        .send({ config: { agent: { name: 'changed' }, llms: {} } });

      expect(res.status).toBe(200);
      expect(writeFile).toHaveBeenCalledOnce();
      expect(refreshConfig).toHaveBeenCalledOnce();
    });

    it('returns 500 when writing fails', async () => {
      vi.spyOn(fs, 'writeFile').mockRejectedValue(new Error('EACCES'));

      const res = await request(app)
        .post('/api/config')
        .send({ config: { agent: { name: 'x' }, llms: {} } });

      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
    });

    it('does not write config.json or refresh when the .env write fails', async () => {
      const writeFile = vi.spyOn(fs, 'writeFile').mockRejectedValue(new Error('EACCES'));

      const res = await request(app)
        .post('/api/config')
        .send({ apiKeys: { OPENAI_API_KEY: 'new-key' }, config: { agent: { name: 'changed' }, llms: {} } });

      expect(res.status).toBe(500);
      expect(writeFile).toHaveBeenCalledTimes(1);
      expect(String(writeFile.mock.calls[0]![0])).toContain('.env');
      expect(refreshConfig).not.toHaveBeenCalled();
    });
  });
});

describe('session routes', () => {
  describe('GET /api/session/status', () => {
    it('reports inactive when no session is registered', async () => {
      vi.spyOn(sessionRegistry, 'getActive').mockReturnValue(undefined);
      const res = await request(app).get('/api/session/status');
      expect(res.status).toBe(200);
      expect(res.body.active).toBe(false);
    });

    it('reports active and includes session status', async () => {
      vi.spyOn(sessionRegistry, 'getActive').mockReturnValue({
        getStatus: () => ({ id: 's1', state: 'running' }),
      } as never);
      const res = await request(app).get('/api/session/status');
      expect(res.status).toBe(200);
      expect(res.body.active).toBe(true);
      expect(res.body.session).toEqual({ id: 's1', state: 'running' });
    });
  });

  describe('GET /api/session/configs', () => {
    it('returns [] when the configs directory does not exist', async () => {
      vi.spyOn(fs, 'access').mockRejectedValue(new Error('ENOENT'));
      const res = await request(app).get('/api/session/configs');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ configs: [] });
    });

    it('lists parseable .json configs, skipping seating files and bad JSON', async () => {
      vi.spyOn(fs, 'access').mockResolvedValue(undefined as never);
      vi.spyOn(fs, 'readdir').mockResolvedValue([
        'good.json',
        'game.seating.json',
        'broken.json',
        'notes.txt',
      ] as never);
      vi.spyOn(fs, 'readFile').mockImplementation(async (p: never) => {
        if (String(p).includes('good.json')) return JSON.stringify({ type: 'strategist' });
        return '{ not valid json';
      });

      const res = await request(app).get('/api/session/configs');

      expect(res.status).toBe(200);
      expect(res.body.configs).toHaveLength(1);
      expect(res.body.configs[0].name).toBe('good');
    });
  });

  describe('POST /api/session/start', () => {
    it('rejects a request without a config', async () => {
      const res = await request(app).post('/api/session/start').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/config/i);
    });

    it('rejects when a session is already active', async () => {
      vi.spyOn(sessionRegistry, 'hasActiveSession').mockReturnValue(true);
      const res = await request(app)
        .post('/api/session/start')
        .send({ config: { llmPlayers: {} } });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/already active/i);
    });

    it('rejects a config without llmPlayers', async () => {
      vi.spyOn(sessionRegistry, 'hasActiveSession').mockReturnValue(false);
      const res = await request(app)
        .post('/api/session/start')
        .send({ config: { type: 'strategist' } });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/llmPlayers/i);
    });

    it('starts the strategist loop for a valid config', async () => {
      vi.spyOn(sessionRegistry, 'hasActiveSession').mockReturnValue(false);
      const res = await request(app)
        .post('/api/session/start')
        .send({ config: { llmPlayers: { 0: {} } } });
      expect(res.status).toBe(200);
      expect(runStrategistLoop).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /api/session/save', () => {
    it('requires a filename', async () => {
      const res = await request(app).post('/api/session/save').send({ config: {} });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/filename/i);
    });

    it('requires a config', async () => {
      const res = await request(app).post('/api/session/save').send({ filename: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/config/i);
    });

    it('saves a sanitized .json file and echoes the final name', async () => {
      vi.spyOn(fs, 'access').mockResolvedValue(undefined as never);
      const writeFile = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined as never);

      const res = await request(app)
        .post('/api/session/save')
        .send({ filename: 'my/cfg', config: { type: 'strategist', llmPlayers: { 0: {} } } });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.filename).toBe('my_cfg.json');
      expect(writeFile).toHaveBeenCalled();
    });
  });

  describe('DELETE /api/session/config/:filename', () => {
    it('returns 404 when the config file does not exist', async () => {
      vi.spyOn(fs, 'access').mockRejectedValue(new Error('ENOENT'));
      const res = await request(app).delete('/api/session/config/missing.json');
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it('deletes an existing config file', async () => {
      vi.spyOn(fs, 'access').mockResolvedValue(undefined as never);
      const unlink = vi.spyOn(fs, 'unlink').mockResolvedValue(undefined as never);
      const res = await request(app).delete('/api/session/config/keep.json');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(unlink).toHaveBeenCalled();
    });
  });

  describe('POST /api/session/stop', () => {
    it('returns 404 when there is no active session', async () => {
      vi.spyOn(sessionRegistry, 'getActive').mockReturnValue(undefined);
      const res = await request(app).post('/api/session/stop');
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/no active/i);
    });

    it('stops the active session', async () => {
      const stop = vi.fn(async () => {});
      vi.spyOn(sessionRegistry, 'getActive').mockReturnValue({ id: 's1', stop } as never);
      const res = await request(app).post('/api/session/stop');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(stop).toHaveBeenCalled();
    });
  });

  describe('POST /api/session/pause', () => {
    it('returns 404 when there is no active session', async () => {
      vi.spyOn(sessionRegistry, 'getActive').mockReturnValue(undefined);
      const res = await request(app).post('/api/session/pause');
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/no active/i);
    });

    it('pauses the active session and echoes the paused state', async () => {
      const pause = vi.fn(() => {});
      vi.spyOn(sessionRegistry, 'getActive').mockReturnValue({
        id: 's1', pause, isPaused: () => true,
      } as never);
      const res = await request(app).post('/api/session/pause');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.paused).toBe(true);
      expect(pause).toHaveBeenCalled();
    });
  });

  describe('POST /api/session/resume', () => {
    it('returns 404 when there is no active session', async () => {
      vi.spyOn(sessionRegistry, 'getActive').mockReturnValue(undefined);
      const res = await request(app).post('/api/session/resume');
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/no active/i);
    });

    it('resumes the active session and echoes the paused state', async () => {
      const resume = vi.fn(() => {});
      vi.spyOn(sessionRegistry, 'getActive').mockReturnValue({
        id: 's1', resume, isPaused: () => false,
      } as never);
      const res = await request(app).post('/api/session/resume');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.paused).toBe(false);
      expect(resume).toHaveBeenCalled();
    });
  });

  describe('GET /api/session/players-summary', () => {
    it('returns 404 when there is no active session', async () => {
      vi.spyOn(sessionRegistry, 'getActive').mockReturnValue(undefined);
      const res = await request(app).get('/api/session/players-summary');
      expect(res.status).toBe(404);
    });

    it('returns only the major players from the MCP get-players result', async () => {
      vi.spyOn(sessionRegistry, 'getActive').mockReturnValue(
        { id: 's1', getPlayerAssignments: () => undefined } as never,
      );
      const mcp = installMockMcpClient();
      mcp.respondWith(
        'get-players',
        structuredResult({
          '0': { IsMajor: true, Civilization: 'Rome' },
          '1': { IsMajor: false, Civilization: 'Barbarians' },
          '2': 'string-entry',
        }),
      );

      const res = await request(app).get('/api/session/players-summary');

      expect(res.status).toBe(200);
      expect(Object.keys(res.body.players)).toEqual(['0']);
      expect(res.body.players['0'].Civilization).toBe('Rome');
    });

    it('returns 500 when the MCP call fails', async () => {
      vi.spyOn(sessionRegistry, 'getActive').mockReturnValue({ id: 's1' } as never);
      const mcp = installMockMcpClient();
      mcp.failWith('get-players', new Error('mcp down'));

      const res = await request(app).get('/api/session/players-summary');
      expect(res.status).toBe(500);
      expect(res.body).toHaveProperty('error');
    });
  });
});
