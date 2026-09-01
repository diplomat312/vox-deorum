/** Model support tool for the civilization's own plaintext Current Outlook. */

import { trace } from '@opentelemetry/api';
import { z } from 'zod';
import type { Tool } from 'ai';
import type { VoxContext } from '../infra/vox-context.js';
import type { StrategistParameters } from '../strategist/strategy-parameters.js';
import { createSimpleTool } from '../utils/tools/simple-tools.js';

/** Create the single semantic memory support action for unified wakes. */
export function createCivilizationMemoryTools(context: VoxContext<StrategistParameters>): Record<string, Tool> {
  return {
    'update-civilization-outlook': createSimpleTool<StrategistParameters>({
      name: 'update-civilization-outlook',
      description: 'Rewrite our concise plaintext Current Outlook when this wake materially changes our political or strategic self-understanding. This support action does not end the wake.',
      inputSchema: z.object({
        Outlook: z.string().min(1).max(30000).describe('Our natural-language political and strategic outlook for future wakes.'),
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
        const outlook = store.updateOutlook(scope, input.Outlook, revision, options.toolCallId);
        parameters.civilizationMemoryOutlookRevision = outlook.revision;
        return 'Current Outlook updated for our future wakes. Continue this wake and choose its normal terminal action.';
      },
    }, context),
  };
}
