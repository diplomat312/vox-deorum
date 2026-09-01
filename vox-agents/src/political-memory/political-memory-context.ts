/**
 * @module political-memory/political-memory-context
 *
 * Shared bounded retrieval for the strategic, diplomacy, and deal wake adapters. The same store
 * and renderer are used for every wake so semantic continuity does not split by framework adapter.
 */

import type { ModelMessage } from 'ai';
import type { StrategistParameters } from '../strategist/strategy-parameters.js';
import type { PoliticalMemorySnapshot } from './types.js';

/** Render one memory snapshot without exposing database implementation details to the model. */
function renderSnapshot(snapshot: PoliticalMemorySnapshot): string {
  const sections: string[] = [];
  if (snapshot.goals.length) sections.push(`## Active and recent goals\n${snapshot.goals.map(item => `- [${item.priority}] ${item.title}${item.description ? `: ${item.description}` : ''} (${item.status})`).join('\n')}`);
  if (snapshot.commitments.length) sections.push(`## Commitments\n${snapshot.commitments.map(item => `- ${item.kind}, ${item.status}, parties ${item.parties.join(', ')}: ${item.summary}${item.terms ? ` Terms: ${item.terms}` : ''}`).join('\n')}`);
  if (snapshot.relationships.length) sections.push(`## Subjective relationships\n${snapshot.relationships.map(item => `- Player ${item.counterpartPlayerId}: trust ${item.trust}/100, grievance ${item.grievance}/100, favor ${item.favor}/100, threat ${item.threat}/100${item.summary ? `, ${item.summary}` : ''}`).join('\n')}`);
  if (snapshot.beliefs.length) sections.push(`## Uncertain beliefs\n${snapshot.beliefs.map(item => `- ${item.subject}: ${item.claim} (confidence ${item.confidence}, ${item.status})`).join('\n')}`);
  if (snapshot.episodes.length) sections.push(`## Important episodes\n${snapshot.episodes.map(item => `- Turn ${item.turn}, ${item.importance}: ${item.summary}${item.counterpartPlayerIds.length ? ` (players ${item.counterpartPlayerIds.join(', ')})` : ''}`).join('\n')}`);
  if (snapshot.projects.length) sections.push(`## Political projects\n${snapshot.projects.map(item => `- [${item.priority}] ${item.title}${item.description ? `: ${item.description}` : ''} (${item.status})`).join('\n')}`);
  return sections.length ? sections.join('\n\n') : '(No durable political memory has been recorded yet.)';
}

/** Build one shared memory context message for a wake and optional diplomatic counterpart. */
export function getPoliticalMemoryContext(
  parameters: StrategistParameters,
  wakeType: 'strategic' | 'diplomacy' | 'deal',
  counterpartPlayerId?: number,
): ModelMessage | undefined {
  const store = parameters.politicalMemoryStore;
  if (!store) return undefined;
  const snapshot = store.getRelevantMemory({ gameId: parameters.gameID, ownerPlayerId: parameters.playerID, turn: parameters.turn }, counterpartPlayerId);
  const focus = counterpartPlayerId === undefined ? 'the whole civilization' : `counterpart Player ${counterpartPlayerId}`;
  return {
    role: 'user',
    content: `# Durable Political Memory (${wakeType} wake, focused on ${focus})\nThis is the same civilization-owned semantic state used by strategy, diplomacy, and deal decisions. It is an interpretation of evidence, not authoritative game state. Keep it sparse, update it only when politically consequential, and never treat subjective beliefs as facts.\n\n${renderSnapshot(snapshot)}`,
  };
}

/** Register memory support tools on the active context without changing generic agent APIs. */
export function memoryToolNames(): string[] {
  return ['set-political-goal', 'resolve-political-goal', 'record-commitment', 'resolve-commitment', 'adjust-political-relationship', 'update-political-belief', 'resolve-political-belief', 'remember-political-episode', 'set-political-project', 'resolve-political-project'];
}
