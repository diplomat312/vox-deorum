/** Model support tool for the civilization's own plaintext Current Outlook. */

import { trace } from '@opentelemetry/api';
import { z } from 'zod';
import type { Tool } from 'ai';
import type { VoxContext } from '../infra/vox-context.js';
import type { StrategistParameters } from '../strategist/strategy-parameters.js';
import { createSimpleTool } from '../utils/tools/simple-tools.js';
import { CivilizationOutlookConflictError } from './civilization-memory-store.js';
import { MAX_OUTLOOK_CHARACTERS } from './civilization-memory-budget.js';

/** Create the single Current Outlook support action for unified wakes. */
export function createCivilizationMemoryTools(context: VoxContext<StrategistParameters>): Record<string, Tool> {
  return {
    'update-civilization-outlook': createSimpleTool<StrategistParameters>({
      name: 'update-civilization-outlook',
      description: `Rewrite our concise plaintext Current Outlook when this wake materially changes our political or strategic self-understanding. Keep it under ${MAX_OUTLOOK_CHARACTERS} characters. Include durable priorities, important relationships, unresolved obligations, uncertainties, or ongoing political work. Do not copy routine Chronicle events or maintain turn-by-turn history here. This support action does not end the wake.`,
      inputSchema: z.object({
        Outlook: z.string().min(1).max(MAX_OUTLOOK_CHARACTERS).describe('A concise natural-language political and strategic outlook for future wakes.'),
      }),
      execute: async (input, parameters, options) => {
        const store = parameters.civilizationMemoryStore;
        if (!store) throw new Error('Civilization continuity is not available for this seat.');
        const span = trace.getActiveSpan();
        const scope = {
          gameId: parameters.gameID,
          ownerPlayerId: parameters.playerID,
          turn: parameters.turn,
          ...(span?.spanContext().traceId ? { wakeTraceId: span.spanContext().traceId } : {}),
        };
        const revision = parameters.civilizationMemoryOutlookRevision ?? store.getOutlook(scope)?.revision ?? 0;
        try {
          const outlook = store.updateOutlook(scope, input.Outlook, revision, options.toolCallId);
          parameters.civilizationMemoryOutlookRevision = outlook.revision;
          return 'Current Outlook updated for our future wakes. Continue this wake and choose its normal terminal action.';
        } catch (error) {
          if (!(error instanceof CivilizationOutlookConflictError)) throw error;
          parameters.civilizationMemoryOutlookRevision = error.latest?.revision ?? 0;
          const latestText = error.latest?.text ?? 'No Current Outlook has been written yet.';
          return `Your Current Outlook changed while this wake was in progress. The latest Outlook is:\n\n---\n${latestText}\n---\n\nIf your intended update still applies, rewrite the complete Current Outlook using this latest state and call update-civilization-outlook again. Continue this same wake afterward with its normal terminal action.`;
        }
      },
    }, context),
  };
}
