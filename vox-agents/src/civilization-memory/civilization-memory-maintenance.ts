/**
 * Same-mind maintenance wake for compacting older factual chronicle entries.
 *
 * This is deliberately a small wake with a narrow tool surface. It uses the seat's unified model,
 * so compaction is authored from the same political perspective as strategy, diplomacy, and deals.
 */

import { z } from 'zod';
import type { ModelMessage, Tool } from 'ai';
import type { Model } from '../types/config.js';
import { VoxAgent } from '../infra/vox-agent.js';
import type { VoxContext } from '../infra/vox-context.js';
import { buildUnifiedMindCanonicalIdentity, getUnifiedMindModel } from '../strategist/unified-civilization-mind.js';
import type { StrategistParameters } from '../strategist/strategy-parameters.js';
import { createSimpleTool } from '../utils/tools/simple-tools.js';
import type { ChronicleCompactionRange } from './types.js';

/** Input passed to one deterministic memory-maintenance wake. */
export interface CivilizationMemoryMaintenanceInput {
  range: ChronicleCompactionRange;
  completed?: boolean;
}

/** Build the narrow terminal tool that commits a completed same-mind compaction. */
function createSaveChronicleTool(context: VoxContext<StrategistParameters>): Tool {
  return createSimpleTool<StrategistParameters, { Chronicle: string }, string>({
    name: 'save-long-term-chronicle',
    description: 'Save the rewritten Long-Term Chronicle after preserving important continuity from the supplied older history.',
    inputSchema: z.object({ Chronicle: z.string().min(1).max(60000) }),
    execute: async (input, parameters) => {
      const maintenance = context.currentInput as CivilizationMemoryMaintenanceInput | undefined;
      if (!maintenance) throw new Error('No memory-maintenance wake is active.');
      const store = parameters.civilizationMemoryStore;
      if (!store) throw new Error('Civilization continuity is not available for this seat.');
      store.commitCompaction({ gameId: parameters.gameID, ownerPlayerId: parameters.playerID, turn: parameters.turn, wakeTraceId: maintenance.range.operationKey }, maintenance.range, input.Chronicle);
      maintenance.completed = true;
      context.setMindOutcome('compacted');
      return 'Long-Term Chronicle saved and the factual history checkpoint advanced.';
    },
  }, context);
}

/** A unified civilization memory-maintenance adapter. */
export class CivilizationMemoryMaintenance extends VoxAgent<StrategistParameters, CivilizationMemoryMaintenanceInput, string | undefined> {
  /** Internal registry name for the same-mind maintenance wake. */
  override readonly name = 'unified-mind-memory';
  /** Player-facing description for diagnostics only. */
  override readonly description = 'Unified civilization mind memory maintenance wake';
  /** Exclude this internal adapter from setup selectors. */
  override offeredInSetup = false;
  /** One save action is the only terminal operation in this wake. */
  override completionTools = ['save-long-term-chronicle'];
  /** Keep compaction bounded even if a provider ignores the concise prompt. */
  override maxSteps = 2;

  /** Resolve the same configured model as every other unified wake. */
  override getModel(_parameters: StrategistParameters, _input: CivilizationMemoryMaintenanceInput, overrides: Record<string, Model | string>): Model {
    return getUnifiedMindModel(overrides, this.reasoningTier);
  }

  /** Describe same-mind factual preservation without exposing storage mechanics. */
  override async getSystem(parameters: StrategistParameters): Promise<string> {
    return `${buildUnifiedMindCanonicalIdentity(parameters)}\n\nThis is a memory-maintenance wake of the same civilization mind. Rewrite the Long-Term Chronicle from the supplied history. Preserve important strategies, understandings, obligations, wars, uncertainties, and plans. Do not invent facts or force ambiguous evidence into certainty. Save the result with exactly one save-long-term-chronicle tool call.`;
  }

  /** Supply the current outlook and selected older factual entries to the same model. */
  override async getInitialMessages(parameters: StrategistParameters, input: CivilizationMemoryMaintenanceInput): Promise<ModelMessage[]> {
    const store = parameters.civilizationMemoryStore;
    if (!store) throw new Error('Civilization continuity is not available for this seat.');
    const outlook = store.getOutlook({ gameId: parameters.gameID, ownerPlayerId: parameters.playerID, turn: parameters.turn });
    const longTerm = store.getLongTerm({ gameId: parameters.gameID, ownerPlayerId: parameters.playerID, turn: parameters.turn });
    const history = input.range.entries.map(entry => `Turn ${entry.turn}: ${entry.text}`).join('\n');
    return [{ role: 'user', content: `# Current Outlook\n${outlook?.text ?? 'No Current Outlook has been written yet.'}\n\n# Existing Long-Term Chronicle\n${longTerm?.text ?? 'No long-term chronicle has been written yet.'}\n\n# Older Chronicle History\n${history}` }];
  }

  /** Make the save operation the only legal terminal tool. */
  override getActiveTools(): string[] { return ['save-long-term-chronicle']; }

  /** Register the maintenance tool with the owning context. */
  override getExtraTools(context: VoxContext<StrategistParameters>): Record<string, Tool> {
    return { 'save-long-term-chronicle': createSaveChronicleTool(context) };
  }

  /** Stop only after the save tool has committed successfully. */
  override stopCheck(_parameters: StrategistParameters, input: CivilizationMemoryMaintenanceInput): boolean {
    return input.completed === true;
  }
}

export { runCivilizationMemoryMaintenance } from './civilization-memory-maintenance-runner.js';
