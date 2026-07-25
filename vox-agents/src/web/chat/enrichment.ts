/**
 * @module web/chat/enrichment
 *
 * Resolves live session details and stable participant identities for Web chat responses.
 */

import { contextRegistry } from '../../infra/context-registry.js';
import { sessionRegistry } from '../../infra/session-registry.js';
import type { VoxContext } from '../../infra/vox-context.js';
import {
  getRecentGameState,
  type StrategistParameters,
} from '../../strategist/strategy-parameters.js';
import type {
  ChatResponseEnrichment,
  EnvoyThread,
  ParticipantIdentity,
  PlayerAssignment,
} from '../../types/index.js';
import { currentTurnOf } from '../../utils/diplomacy/live-turn.js';
import { audienceID, identityOf } from '../../utils/diplomacy/transcript.js';

// The live-turn resolver now lives beside the shared conversation guard that consumes it
// (`utils/diplomacy/live-turn.ts`), so the chat turn runner and the deal actions cannot drift from
// the Web enrichment view of "what turn is it?". Re-exported here for the Web's existing importers.
export { currentTurnOf };

/** Resolve the active strategist session's per-seat agent assignments, if available. */
export function getActiveAssignments(): Record<number, PlayerAssignment> | undefined {
  return sessionRegistry.getActive()?.getPlayerAssignments();
}

/** Resolve the seat assigned to the human strategist, if one exists. */
export function resolveHumanSeat(assignments?: Record<number, PlayerAssignment>): number | undefined {
  if (!assignments) return undefined;
  for (const [id, assignment] of Object.entries(assignments)) {
    if (assignment.strategist === 'human-strategist') return parseInt(id);
  }
  return undefined;
}

/** Resolve a player's civilization and leader from the latest eligible live game state. */
export function civIdentity(
  context: VoxContext<StrategistParameters> | undefined,
  playerID: number,
): ParticipantIdentity | undefined {
  const parameters = context?.getBaseParameters();
  if (!parameters || playerID < 0 || !parameters.gameStates) return undefined;

  const ceiling = currentTurnOf(context) ?? Number.MAX_SAFE_INTEGER;
  const data = getRecentGameState(parameters, ceiling)?.players?.[playerID.toString()];
  if (typeof data !== 'object' || data === null) return undefined;

  const civilization = (data as Record<string, unknown>).Civilization;
  const leader = (data as Record<string, unknown>).Leader;
  if (typeof civilization !== 'string') return undefined;

  return {
    name: civilization,
    leader: typeof leader === 'string' ? leader : '',
  };
}

/** Format a participant identity for display. */
export function displayIdentity(identity: ParticipantIdentity | undefined): string | undefined {
  if (!identity) return undefined;
  return identity.leader ? `${identity.leader} of ${identity.name}` : identity.name;
}

/** Build current-turn and participant display enrichment for a chat response. */
export function enrichChat(thread: EnvoyThread): ChatResponseEnrichment {
  const context = contextRegistry.get<StrategistParameters>(thread.contextId);
  return {
    currentTurn: currentTurnOf(context),
    voicedID: thread.agent,
    voicedCiv: displayIdentity(identityOf(thread, thread.agent)),
    audienceCiv: displayIdentity(identityOf(thread, audienceID(thread))),
  };
}
