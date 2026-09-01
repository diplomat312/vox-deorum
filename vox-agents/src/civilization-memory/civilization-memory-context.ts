/**
 * Shared model-facing continuity context for every unified civilization wake.
 *
 * The renderer exposes prose and factual chronology only. Storage identifiers remain outside the
 * prompt so strategy, diplomacy, deal, and future social wakes share one political vocabulary.
 */

import type { ModelMessage } from 'ai';
import type { StrategistParameters } from '../strategist/strategy-parameters.js';
import type { CivilizationChronicleEntry, CivilizationMemoryScope, CivilizationMemorySnapshot } from './types.js';

/** Return the model-visible name for the active civilization. */
function civilizationName(parameters: StrategistParameters): string {
  return parameters.metadata?.YouAre?.Name ?? 'our civilization';
}

/** Render one factual chronicle entry without exposing internal storage metadata. */
function renderEntry(entry: CivilizationChronicleEntry, parameters: StrategistParameters): string {
  const ownName = civilizationName(parameters);
  const text = entry.text.replace(/\s+/g, ' ').trim();
  const prefix = entry.scope === 'private' ? 'Private history' : entry.scope === 'group' ? 'Group history' : 'History';
  return `${prefix} · Turn ${entry.turn} · ${ownName}: ${text}`;
}

/** Render a bounded civilization memory snapshot as natural-language context. */
function renderMemory(snapshot: CivilizationMemorySnapshot, parameters: StrategistParameters, wake: string): string {
  const lines = [`# Civilization Continuity`, `This is the continuing memory of ${civilizationName(parameters)} for this ${wake} wake.`];
  lines.push('', '# Current Outlook');
  lines.push(snapshot.outlook?.text || 'No Current Outlook has been written yet. If this wake establishes durable priorities or political context, create one with the outlook tool.');
  if (snapshot.longTerm?.text) {
    lines.push('', '# Long-Term Chronicle', snapshot.longTerm.text);
  }
  lines.push('', '# Recent Chronicle');
  if (snapshot.recentChronicle.length === 0) lines.push('No recent chronicle entries.');
  else lines.push(...snapshot.recentChronicle.map(entry => renderEntry(entry, parameters)));
  return lines.join('\n');
}

/** Build the shared continuity message and capture the revision used by the update tool. */
export function buildCivilizationMemoryContext(
  parameters: StrategistParameters,
  wake: 'strategic' | 'diplomacy' | 'deal' | 'memory',
  counterpartPlayerId?: number,
): ModelMessage | undefined {
  const store = parameters.civilizationMemoryStore;
  if (!store) return undefined;
  const scope: CivilizationMemoryScope = {
    gameId: parameters.gameID,
    ownerPlayerId: parameters.playerID,
    turn: parameters.turn,
  };
  const snapshot = store.getSnapshot(scope);
  parameters.civilizationMemoryOutlookRevision = snapshot.outlook?.revision ?? 0;
  // The store is already scoped to this civilization. Keep the same Outlook and chronicle assembly
  // for every wake; counterpart-specific transcript retrieval remains a separate diplomacy layer.
  void counterpartPlayerId;
  return { role: 'user', content: renderMemory(snapshot, parameters, wake) };
}

/** Return the one semantic continuity support tool exposed to unified wakes. */
export function civilizationMemoryToolNames(): string[] {
  return ['update-civilization-outlook'];
}
