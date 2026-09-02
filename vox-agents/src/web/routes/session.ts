/**
 * @module web/routes/session
 *
 * API routes for game session management.
 * Provides endpoints for starting, stopping, and monitoring game sessions.
 */

import { Router, Request, Response } from 'express';
import { sessionRegistry } from '../../infra/session-registry.js';
import { runStrategistLoop } from '../../strategist/loop.js';
import { resolveMaxRepetitions } from '../../strategist/repetition.js';
import { Model, SessionConfig, StrategistSessionConfig } from '../../types/config.js';
import { createLogger } from '../../utils/logger.js';
import { config, getConfigsDir } from '../../utils/config.js';
import fs from 'fs/promises';
import path from 'path';
import type {
  SessionStatusResponse,
  SessionConfigEntry,
  SessionConfigsResponse,
  StartSessionRequest,
  StartSessionResponse,
  SaveSessionConfigRequest,
  SaveSessionConfigResponse,
  DeleteSessionConfigResponse,
  StopSessionResponse,
  PauseSessionResponse,
  ResumeSessionResponse,
  PlayersSummaryResponse,
  CivilizationMindsResponse,
  CivilizationMindReadModel,
  CivilizationMindWakeRecord,
  ErrorResponse,
  PlayersReport
} from '../../types/api.js';
import { mcpClient } from '../../utils/models/mcp-client.js';
import { unwrapMcpResponse } from '../../utils/models/mcp-response.js';
import { sqliteExporter } from '../../instrumentation.js';
import { parseSpanAttributes } from '../../utils/telemetry/attributes.js';
import type { Span } from '../../utils/telemetry/schema.js';

const logger = createLogger('webui:session-routes');
const warnedLegacyGameModeFiles = new Set<string>();

type SessionConfigPayload = SessionConfig & Partial<Pick<SessionConfigEntry, 'filename' | 'updatedAt'>>;

/** Read only the major player report used by the session monitoring surfaces. */
async function getMajorPlayers(): Promise<PlayersReport> {
  const result = await mcpClient.callTool('get-players', {});
  const playersData = unwrapMcpResponse(result, 'get-players');
  const allPlayers = (playersData.Result ?? playersData) as PlayersReport;
  const filteredPlayers: PlayersReport = {};
  for (const [playerId, playerData] of Object.entries(allPlayers)) {
    if (typeof playerData === 'object' && playerData !== null && playerData.IsMajor === true) {
      filteredPlayers[playerId] = playerData;
    }
  }
  return filteredPlayers;
}

/** Read bounded completed unified wake spans for one live player context. */
async function getCompletedUnifiedWakes(contextId: string): Promise<CivilizationMindWakeRecord[]> {
  if (!sqliteExporter.getActiveConnections().includes(contextId)) return [];
  const db = sqliteExporter.getDatabase(contextId);
  const rows = await db.selectFrom('spans').selectAll().orderBy('startTime', 'desc').limit(200).execute();
  const wakes: CivilizationMindWakeRecord[] = [];
  for (const row of rows) {
    const span = { ...row, attributes: row.attributes || {} } as Span;
    const attributes = parseSpanAttributes(span);
    if (attributes['mind.mode'] !== 'unified-mind' || attributes['mind.span_role'] !== 'wake') continue;
    const wake = attributes['mind.wake'];
    if (wake !== 'strategic' && wake !== 'diplomacy' && wake !== 'deal' && wake !== 'memory' && wake !== 'social') continue;
    const input = attributes['tokens.input'];
    const reasoning = attributes['tokens.reasoning'];
    const output = attributes['tokens.output'];
    wakes.push({
      wake,
      ...(typeof span.turn === 'number' ? { turn: span.turn } : {}),
      outcome: typeof attributes['mind.outcome'] === 'string' ? attributes['mind.outcome'] : 'no-output',
      model: typeof attributes['mind.model'] === 'string'
        ? attributes['mind.model']
        : typeof attributes.model === 'string' ? attributes.model : undefined,
      durationMs: span.durationMs,
      tokens: {
        ...(typeof input === 'number' ? { input } : {}),
        ...(typeof reasoning === 'number' ? { reasoning } : {}),
        ...(typeof output === 'number' ? { output } : {}),
      },
      timestamp: span.startTime,
      traceId: span.traceId,
      spanId: span.spanId,
    });
  }
  return wakes.reverse().slice(-60);
}

/** Build the canonical civilization-mind read model from session/runtime authorities. */
async function buildCivilizationMinds(session: NonNullable<ReturnType<typeof sessionRegistry.getActive>>): Promise<CivilizationMindReadModel[]> {
  const players = await getMajorPlayers();
  const assignments = session.getPlayerAssignments() ?? {};
  const runtimeContexts = session.getPlayerRuntimeContexts();
  const ids = new Set<number>([
    ...Object.keys(players).map(Number),
    ...Object.keys(assignments).map(Number),
    ...Object.keys(runtimeContexts).map(Number),
  ]);
  return Promise.all([...ids].sort((left, right) => left - right).map(async playerId => {
    const assignment = assignments[playerId];
    const runtime = runtimeContexts[playerId];
    const snapshot = players[String(playerId)];
    const facts = typeof snapshot === 'object' && snapshot !== null ? snapshot : undefined;
    const humanPlayerId = session.getHumanPlayerId?.();
    const memory = session.getCivilizationMemorySnapshot?.(playerId);
    const architecture = assignment?.mind === 'unified-mind'
      ? 'unified-mind' as const
      : humanPlayerId === playerId || assignment?.strategist === 'human-strategist'
        ? 'human' as const
        : assignment ? 'legacy' as const : 'native' as const;
    const recentWakes = runtime ? await getCompletedUnifiedWakes(runtime.contextId) : [];
    return {
      playerId,
      civilization: facts?.Civilization ?? `Player ${playerId}`,
      leader: facts?.Leader ?? 'Unknown leader',
      architecture,
      ...(assignment?.mindModel ?? assignment?.model ? { model: assignment.mindModel ?? assignment.model } : {}),
      ...(runtime ? { runtimeContextId: runtime.contextId } : {}),
      activity: { activeWakes: runtime?.activeWakes ?? [] },
      game: {
        ...(typeof facts?.Score === 'number' ? { score: facts.Score } : {}),
        ...(typeof facts?.CurrentResearch === 'string' ? { currentResearch: facts.CurrentResearch } : {}),
        activeAgreementCount: Object.values(facts?.DiplomaticDeals ?? {})
          .flat()
          .filter(deal => deal.TurnsRemaining > 0).length,
      },
      recentWakes,
      ...(architecture === 'unified-mind' && memory
        ? { memory }
        : {}),
    } satisfies CivilizationMindReadModel;
  }));
}

/** Returns global LLM definitions stripped to the fields needed for model display and resolution. */
function sanitizedGlobalLlms(): Record<string, Model | string> {
  return Object.fromEntries(Object.entries(config.llms).map(([name, definition]) => [
    name,
    typeof definition === 'string'
      ? definition
      : { provider: definition.provider, name: definition.name },
  ]));
}

/** Reports whether a request value is one of the supported launch modes. */
function isGameMode(value: unknown): value is NonNullable<StartSessionRequest['gameMode']> {
  return value === 'start' || value === 'load' || value === 'wait';
}

/** Removes launch-time and API-only fields before a config is run or persisted. */
function cleanSessionConfig(config: SessionConfigPayload): SessionConfig {
  const {
    gameMode: _gameMode,
    filename: _filename,
    updatedAt: _updatedAt,
    ...cleaned
  } = config;
  return cleaned;
}

/** Removes a legacy saved launch mode and warns once for each affected configuration file. */
function cleanListedSessionConfig(config: StrategistSessionConfig, filename: string): StrategistSessionConfig {
  const { gameMode: _gameMode, ...cleaned } = config;
  if (Object.hasOwn(config, 'gameMode') && !warnedLegacyGameModeFiles.has(filename)) {
    warnedLegacyGameModeFiles.add(filename);
    logger.warn(`Ignoring legacy gameMode in ${filename}; choose the launch mode when starting the session.`);
  }
  return cleaned;
}

/**
 * Create session management routes.
 */
export function createSessionRoutes(): Router {
  const router = Router();

  /**
   * GET /api/session/status
   * Get the current session status.
   */
  router.get('/status', (_req: Request, res: Response<SessionStatusResponse | ErrorResponse>) => {
    try {
      const session = sessionRegistry.getActive();

      const response: SessionStatusResponse = {
        active: !!session,
        session: session?.getStatus()
      };
      res.json(response);
    } catch (error) {
      logger.error('Failed to get session status', { error });
      const errorResponse: ErrorResponse = { error: 'Failed to get session status' };
      res.status(500).json(errorResponse);
    }
  });

  /**
   * GET /api/session/configs
   * List available configuration files from the configs directory.
   */
  router.get('/configs', async (_req: Request, res: Response<SessionConfigsResponse | ErrorResponse>) => {
    try {
      const configDir = getConfigsDir();

      // Check if configs directory exists
      try {
        await fs.access(configDir);
      } catch {
        const response: SessionConfigsResponse = { configs: [], globalLlms: sanitizedGlobalLlms() };
        res.json(response);
        return;
      }

      const files = await fs.readdir(configDir);

      // Filter and parse JSON config files
      const configs = (await Promise.all(
        files
          .filter(f => f.endsWith('.json') && !f.endsWith('.seating.json'))
          .map(async filename => {
            try {
              const filePath = path.join(configDir, filename);
              const [content, stats] = await Promise.all([fs.readFile(filePath, 'utf-8'), fs.stat(filePath)]);
              const config = JSON.parse(content) as SessionConfig;
              if (config.type !== undefined && config.type !== 'strategist') return undefined;
              if (!('llmPlayers' in config) || typeof config.llmPlayers !== 'object') return undefined;
              const strategistConfig = cleanListedSessionConfig(config as StrategistSessionConfig, filename);
              return {
                ...strategistConfig,
                name: filename.replace('.json', ''),
                type: 'strategist',
                filename,
                updatedAt: stats.mtime.toISOString(),
              } satisfies SessionConfigEntry;
            } catch (error) {
              logger.warn(`Failed to parse config file ${filename}:`, error);
              return undefined;
            }
          })
      )).filter((entry): entry is SessionConfigEntry => entry !== undefined)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

      const response: SessionConfigsResponse = { configs, globalLlms: sanitizedGlobalLlms() };
      res.json(response);
    } catch (error) {
      logger.error('Failed to list configs', { error });
      const errorResponse: ErrorResponse = { error: 'Failed to list configurations' };
      res.status(500).json(errorResponse);
    }
  });

  /**
   * POST /api/session/start
   * Start a new game session with the specified configuration.
   */
  router.post('/start', async (req: Request<object, object, StartSessionRequest>, res: Response<StartSessionResponse | ErrorResponse>) => {
    const { config: requestedConfig, gameMode = 'start' } = req.body;

    if (!requestedConfig) {
      const errorResponse: ErrorResponse = { error: 'Config object required' };
      res.status(400).json(errorResponse);
      return;
    }

    if (!isGameMode(gameMode)) {
      const errorResponse: ErrorResponse = { error: 'gameMode must be start, load, or wait' };
      res.status(400).json(errorResponse);
      return;
    }

    // Check for existing session
    if (sessionRegistry.hasActiveSession()) {
      const errorResponse: ErrorResponse = { error: 'A session is already active' };
      res.status(400).json(errorResponse);
      return;
    }

    try {
      const config = { ...cleanSessionConfig(requestedConfig as SessionConfigPayload), gameMode };

      // Ensure config has the required type
      if (!config.type) {
        config.type = 'strategist';
      }

      // Validate it's a StrategistSessionConfig
      const strategistConfig = config as StrategistSessionConfig;

      // Validate required fields
      if (!strategistConfig.llmPlayers || typeof strategistConfig.llmPlayers !== 'object') {
        const errorResponse: ErrorResponse = { error: 'Config must include llmPlayers configuration' };
        res.status(400).json(errorResponse);
        return;
      }

      // Resolve repetition with the same shared policy as the console entry point
      // (which now also warns when "auto" is set without a cycle enabled).
      const { maxRepetitions, cycleEnabled, isAutoRepetition } = resolveMaxRepetitions(strategistConfig);

      // Kick off the loop in the background — sessions appear in
      // `sessionRegistry` as the loop creates them (the session lifecycle
      // self-registers/unregisters), so the client polls `/api/session/status`.
      runStrategistLoop({
        config: strategistConfig,
        maxRepetitions,
        stopAfterCurrentCycle: isAutoRepetition && cycleEnabled,
      }).catch(error => {
        logger.error('Strategist loop failed', { error });
      });

      const response: StartSessionResponse = {};
      res.json(response);
    } catch (error) {
      logger.error('Failed to start session', { error });
      const errorResponse: ErrorResponse = { error: `Failed to start session: ${(error as Error).message}` };
      res.status(500).json(errorResponse);
    }
  });

  /**
   * POST /api/session/save
   * Save a session configuration to a local file.
   */
  router.post('/save', async (req: Request<object, object, SaveSessionConfigRequest>, res: Response<SaveSessionConfigResponse | ErrorResponse>) => {
    const { filename, config } = req.body;

    if (!filename) {
      const errorResponse: ErrorResponse = { error: 'Filename required' };
      res.status(400).json(errorResponse);
      return;
    }

    if (!config) {
      const errorResponse: ErrorResponse = { error: 'Config object required' };
      res.status(400).json(errorResponse);
      return;
    }

    const configToSave = cleanSessionConfig(config as SessionConfigPayload);

    // Sanitize filename - remove path characters and ensure .json extension
    const sanitizedName = filename.replace(/[/\\:*?"<>|]/g, '_');
    const finalFilename = sanitizedName.endsWith('.json') ? sanitizedName : `${sanitizedName}.json`;

    try {
      // Ensure configs directory exists
      const configDir = getConfigsDir();
      try {
        await fs.access(configDir);
      } catch {
        await fs.mkdir(configDir, { recursive: true });
      }

      // Validate the config has minimum required fields
      if (!configToSave.type) {
        configToSave.type = 'strategist';
      }

      // Additional validation for strategist configs
      if (configToSave.type === 'strategist') {
        const strategistConfig = configToSave as StrategistSessionConfig;
        if (!strategistConfig.llmPlayers || typeof strategistConfig.llmPlayers !== 'object') {
          const errorResponse: ErrorResponse = { error: 'Strategist config must include llmPlayers configuration' };
          res.status(400).json(errorResponse);
          return;
        }
      }

      // Set the config name based on filename (without .json)
      configToSave.name = finalFilename.replace('.json', '');

      // Write the config file
      const configPath = path.join(configDir, finalFilename);
      await fs.writeFile(configPath, JSON.stringify(configToSave, null, 2), 'utf-8');

      logger.info(`Saved configuration to ${finalFilename}`);

      const response: SaveSessionConfigResponse = {
        success: true,
        filename: finalFilename,
        path: configPath
      };
      res.json(response);
    } catch (error) {
      logger.error('Failed to save config', { error });
      const errorResponse: ErrorResponse = { error: `Failed to save configuration: ${(error as Error).message}` };
      res.status(500).json(errorResponse);
    }
  });

  /**
   * DELETE /api/session/config/:filename
   * Delete a saved configuration file.
   */
  router.delete('/config/:filename', async (req: Request<{ filename: string }>, res: Response<DeleteSessionConfigResponse | ErrorResponse>) => {
    const { filename } = req.params;

    if (!filename) {
      const errorResponse: ErrorResponse = { error: 'Filename required' };
      res.status(400).json(errorResponse);
      return;
    }

    // Sanitize filename - remove path characters and ensure .json extension
    const sanitizedName = filename.replace(/[/\\:*?"<>|]/g, '_');
    const finalFilename = sanitizedName.endsWith('.json') ? sanitizedName : `${sanitizedName}.json`;

    try {
      const configDir = getConfigsDir();
      const configPath = path.join(configDir, finalFilename);

      // Check if file exists
      try {
        await fs.access(configPath);
      } catch {
        const errorResponse: ErrorResponse = { error: `Config file not found: ${finalFilename}` };
        res.status(404).json(errorResponse);
        return;
      }

      // Delete the file
      await fs.unlink(configPath);

      logger.info(`Deleted configuration file: ${finalFilename}`);

      const response: DeleteSessionConfigResponse = {
        success: true,
        message: `Configuration ${finalFilename} deleted successfully`
      };
      res.json(response);
    } catch (error) {
      logger.error('Failed to delete config', { error });
      const errorResponse: ErrorResponse = { error: `Failed to delete configuration: ${(error as Error).message}` };
      res.status(500).json(errorResponse);
    }
  });

  /**
   * POST /api/session/stop
   * Stop the currently active session.
   */
  router.post('/stop', async (_req: Request, res: Response<StopSessionResponse | ErrorResponse>) => {
    const session = sessionRegistry.getActive();

    if (!session) {
      const errorResponse: ErrorResponse = { error: 'No active session' };
      res.status(404).json(errorResponse);
      return;
    }

    try {
      logger.info(`Stopping session ${session.id}`);

      // Stop the session (this will unregister it)
      await session.stop();

      const response: StopSessionResponse = {
        success: true,
        message: 'Session stopped successfully'
      };
      res.json(response);
    } catch (error) {
      logger.error('Failed to stop session', { error });
      const errorResponse: ErrorResponse = { error: `Failed to stop session: ${(error as Error).message}` };
      res.status(500).json(errorResponse);
    }
  });

  /**
   * POST /api/session/pause
   * Pause the currently active session: no new LLM runs start and the game
   * stalls in place. In-flight runs finish; nothing is aborted.
   */
  router.post('/pause', (_req: Request, res: Response<PauseSessionResponse | ErrorResponse>) => {
    const session = sessionRegistry.getActive();

    if (!session) {
      const errorResponse: ErrorResponse = { error: 'No active session' };
      res.status(404).json(errorResponse);
      return;
    }

    try {
      logger.info(`Pausing session ${session.id}`);
      session.pause();

      const response: PauseSessionResponse = {
        success: true,
        message: 'Session paused successfully',
        paused: session.isPaused()
      };
      res.json(response);
    } catch (error) {
      logger.error('Failed to pause session', { error });
      const errorResponse: ErrorResponse = { error: `Failed to pause session: ${(error as Error).message}` };
      res.status(500).json(errorResponse);
    }
  });

  /**
   * POST /api/session/resume
   * Resume a paused session; agent loops pick their held turns back up.
   */
  router.post('/resume', (_req: Request, res: Response<ResumeSessionResponse | ErrorResponse>) => {
    const session = sessionRegistry.getActive();

    if (!session) {
      const errorResponse: ErrorResponse = { error: 'No active session' };
      res.status(404).json(errorResponse);
      return;
    }

    try {
      logger.info(`Resuming session ${session.id}`);
      session.resume();

      const response: ResumeSessionResponse = {
        success: true,
        message: 'Session resumed successfully',
        paused: session.isPaused()
      };
      res.json(response);
    } catch (error) {
      logger.error('Failed to resume session', { error });
      const errorResponse: ErrorResponse = { error: `Failed to resume session: ${(error as Error).message}` };
      res.status(500).json(errorResponse);
    }
  });

  /**
   * GET /api/session/players-summary
   *
   * Get summary of all major players in the active session
   */
  router.get('/players-summary', async (_req: Request, res: Response<PlayersSummaryResponse | ErrorResponse>) => {
    const session = sessionRegistry.getActive();

    if (!session) {
      const errorResponse: ErrorResponse = { error: 'No active session' };
      res.status(404).json(errorResponse);
      return;
    }

    try {
      // Get all players from MCP server
      const result = await mcpClient.callTool('get-players', {});

      // Extract the actual data from the MCP result structure
      let playersData = unwrapMcpResponse(result, 'get-players');
      playersData = (playersData.Result ?? playersData) as Record<string, unknown>;

      // Type the data properly as PlayersReport
      const allPlayers = playersData as PlayersReport;

      // Filter to only major players (IsMajor: true and data is object, not string)
      const filteredPlayers: PlayersReport = {};

      for (const [playerId, playerData] of Object.entries(allPlayers)) {
        if (typeof playerData === 'object' && playerData !== null && playerData.IsMajor === true) {
          filteredPlayers[playerId] = playerData;
        }
      }

      // Get AI player assignments from the session if available
      const assignments = session.getPlayerAssignments();

      const response: PlayersSummaryResponse = {
        players: filteredPlayers,
        assignments
      };
      res.json(response);
    } catch (error) {
      logger.error('Failed to get players summary', { error });
      const errorResponse: ErrorResponse = {
        error: `Failed to get players summary: ${(error as Error).message}`
      };
      res.status(500).json(errorResponse);
    }
  });

  /**
   * GET /api/session/minds
   * Return one sanitized read model per known civilization seat. Runtime activity comes from live
   * roots, while history comes only from completed canonical wake spans.
   */
  router.get('/minds', async (_req: Request, res: Response<CivilizationMindsResponse | ErrorResponse>) => {
    const session = sessionRegistry.getActive();
    if (!session) {
      res.status(404).json({ error: 'No active session' });
      return;
    }
    try {
      res.json({ minds: await buildCivilizationMinds(session) });
    } catch (error) {
      logger.error('Failed to get civilization minds', { error });
      res.status(500).json({ error: `Failed to get civilization minds: ${(error as Error).message}` });
    }
  });

  return router;
}

// Export default for consistency with other route modules
export default createSessionRoutes();
