/** Threshold-gated entry point for same-mind Chronicle maintenance. */

import type { VoxContext } from '../infra/vox-context.js';
import type { StrategistParameters } from '../strategist/strategy-parameters.js';
import { RECENT_CHRONICLE_SOFT_TOKEN_LIMIT, RECENT_CHRONICLE_TARGET_TOKEN_LIMIT } from './civilization-memory-budget.js';

/** Attempt one pending compaction before an ordinary unified wake without blocking the game on failure. */
export async function runCivilizationMemoryMaintenance(
  context: VoxContext<StrategistParameters>,
  parameters: StrategistParameters,
): Promise<void> {
  const store = parameters.civilizationMemoryStore;
  const scope = { gameId: parameters.gameID, ownerPlayerId: parameters.playerID, turn: parameters.turn };
  if (!store) return;
  const snapshot = store.getSnapshot(scope);
  context.logger.debug('Civilization continuity maintenance check.', {
    gameID: parameters.gameID,
    playerID: parameters.playerID,
    recentTokens: snapshot.uncompactedChronicleTokenCount ?? snapshot.recentChronicleTokenCount,
    softLimit: RECENT_CHRONICLE_SOFT_TOKEN_LIMIT,
    maintenance: snapshot.maintenanceRequired,
  });
  if (!snapshot.maintenanceRequired) return;
  const range = store.selectCompactionRange(scope, {
    targetRemainingTokens: RECENT_CHRONICLE_TARGET_TOKEN_LIMIT,
  });
  if (!range) return;
  try {
    context.logger.info('Civilization memory maintenance starting.', {
      gameID: parameters.gameID,
      playerID: parameters.playerID,
      beforeTokens: snapshot.uncompactedChronicleTokenCount ?? snapshot.recentChronicleTokenCount,
      selectedEntries: range.entries.length,
      targetTokens: RECENT_CHRONICLE_TARGET_TOKEN_LIMIT,
    });
    await context.execute('unified-mind-memory', { range }, undefined, undefined, undefined, { throwOnError: true });
  } catch (error) {
    context.logger.warn('Civilization memory maintenance failed; ordinary cognition will continue.', { gameID: parameters.gameID, playerID: parameters.playerID, turn: parameters.turn, error });
    store.refreshMaintenanceRequirement(scope);
  }
}
