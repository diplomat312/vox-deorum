/**
 * External function registration endpoints for the Bridge Service
 */

import { Router, Request, Response } from 'express';
import { createLogger } from '../utils/logger.js';
import { handleAPIError } from '../utils/api.js';
import { ErrorCode, respondError, respondSuccess } from '../types/api.js';
import { externalManager } from '../services/external-manager.js';
import { ExternalFunctionRegistration } from '../types/external.js';
import { pauseManager, MaxCivs } from '../services/pause-manager.js';

const logger = createLogger('ExternalRoutes');
const router = Router();

/**
 * POST /external/register - Register an external function
 */
router.post('/register', async (req: Request, res: Response) => {
  await handleAPIError(res, '/external/register', async () => {
    const registration: ExternalFunctionRegistration = req.body;
    logger.info(`Registering external function: ${registration.name}`);
    
    // Let the manager handle all validation and error responses
    const result = await externalManager.registerFunction(registration);
    
    return result;
  });
});

/**
 * DELETE /external/register/:name - Unregister an external function
 */
router.delete('/register/:name', async (req: Request, res: Response) => {
  await handleAPIError(res, '/external/register/:name', async () => {
    const functionName = req.params.name;
    logger.info(`Unregistering external function: ${functionName}`);
    
    const result = await externalManager.unregisterFunction(functionName);
    return result;
  });
});

/**
 * GET /external/functions - List all registered external functions
 */
router.get('/functions', async (_req: Request, res: Response) => {
  await handleAPIError(res, '/external/functions', async () => {
    logger.info('Fetching registered external functions');
    const result = externalManager.getFunctions();
    return result;
  });
});

/**
 * POST /external/pause - Pause the game (manual operation)
 */
router.post('/pause', async (_req: Request, res: Response) => {
  await handleAPIError(res, '/external/pause', async () => {
    if (!pauseManager.pauseGame()) {
      return respondError(ErrorCode.INTERNAL_ERROR, 'Failed to pause the game');
    }
    return respondSuccess();
  });
});

/**
 * POST /external/resume - Resume the game (manual operation)
 */
router.post('/resume', async (_req: Request, res: Response) => {
  await handleAPIError(res, '/external/resume', async () => {
    if (!pauseManager.resumeGame()) {
      return respondError(ErrorCode.INTERNAL_ERROR, 'Failed to resume the game');
    }
    return respondSuccess();
  });
});

/**
 * POST /external/pause-player/:id - Register a player for auto-pause
 */
router.post('/pause-player/:id', async (req: Request, res: Response) => {
  await handleAPIError(res, '/external/pause-player/:id', async () => {
    const playerId = parseInt(req.params.id);
    if (isNaN(playerId) || playerId < 0 || playerId >= MaxCivs) {
      return respondError(ErrorCode.INVALID_ARGUMENTS, 'Invalid player ID');
    }

    if (!pauseManager.registerPausedPlayer(playerId)) {
      return respondError(ErrorCode.DLL_DISCONNECTED, `Failed to register player ${playerId} for auto-pause`);
    }

    return respondSuccess({
      pausedPlayers: pauseManager.getPausedPlayers()
    });
  });
});

/**
 * DELETE /external/pause-player/:id - Unregister a player from auto-pause
 */
router.delete('/pause-player/:id', async (req: Request, res: Response) => {
  await handleAPIError(res, '/external/pause-player/:id', async () => {
    const playerId = parseInt(req.params.id);
    if (isNaN(playerId) || playerId < 0 || playerId >= MaxCivs) {
      return respondError(ErrorCode.INVALID_ARGUMENTS, 'Invalid player ID');
    }

    if (!pauseManager.unregisterPausedPlayer(playerId)) {
      return respondError(ErrorCode.DLL_DISCONNECTED, `Failed to unregister player ${playerId} from auto-pause`);
    }

    return respondSuccess({
      pausedPlayers: pauseManager.getPausedPlayers()
    });
  });
});

/**
 * GET /external/paused-players - Get list of paused players
 */
router.get('/paused-players', async (_req: Request, res: Response) => {
  await handleAPIError(res, '/external/paused-players', async () => {
    return respondSuccess({
      pausedPlayers: pauseManager.getPausedPlayers(),
      isGamePaused: pauseManager.isGamePaused()
    });
  });
});

/**
 * DELETE /external/paused-players - Clear all paused players
 */
router.delete('/paused-players', async (_req: Request, res: Response) => {
  await handleAPIError(res, '/external/paused-players', async () => {
    pauseManager.clearPausedPlayers();
    return respondSuccess({
      pausedPlayers: pauseManager.getPausedPlayers()
    });
  });
});

/**
 * POST /external/production-mode - Set production mode (enables AI turn cooldown in DLL)
 */
router.post('/production-mode', async (req: Request, res: Response) => {
  await handleAPIError(res, '/external/production-mode', async () => {
    const { enabled } = req.body;
    pauseManager.setProductionMode(!!enabled);
    return respondSuccess({
      productionMode: pauseManager.isProductionMode()
    });
  });
});

export default router;
