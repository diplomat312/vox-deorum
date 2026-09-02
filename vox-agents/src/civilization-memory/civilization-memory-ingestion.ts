/**
 * Mechanical ingestion of facts into civilization chronicles.
 *
 * These helpers record source facts only. They never classify an event as a betrayal, promise,
 * grievance, or political priority. That interpretation remains inside the unified mind.
 */

import type { StrategistParameters } from '../strategist/strategy-parameters.js';
import type { EnvoyThread } from '../types/index.js';
import type { TranscriptPushMessage } from '../utils/diplomacy/transcript/transcript-utils.js';
import type { CivilizationMemoryStore } from './civilization-memory-store.js';
import type { SocialCommittedFact } from '../social/runtime/social-environment-port.js';

/** Return a human-readable participant name from the latest bounded player report. */
function participantName(parameters: StrategistParameters, playerId: number): string {
  const players = parameters.gameStates[parameters.turn]?.players as Record<string, unknown> | undefined;
  const raw = players?.[String(playerId)];
  const player = raw && typeof raw === 'object' ? raw as Record<string, unknown> : undefined;
  const civilization = typeof player?.Civilization === 'string' ? player.Civilization : undefined;
  const leader = typeof player?.Leader === 'string' ? player.Leader : undefined;
  if (civilization && leader) return `${civilization} / ${leader}`;
  return civilization ?? `civilization ${playerId}`;
}

/** Append one private transcript row to both entitled civilization chronicles. */
export function appendDiplomacyFact(
  store: CivilizationMemoryStore,
  parameters: StrategistParameters,
  thread: EnvoyThread,
  row: TranscriptPushMessage,
): void {
  const speaker = participantName(parameters, row.SpeakerID);
  const recipient = participantName(parameters, row.SpeakerID === thread.player1ID ? thread.player2ID : thread.player1ID);
  const text = `Turn ${row.Turn} · ${speaker} to ${recipient}: ${row.Content}`;
  for (const ownerPlayerId of [thread.player1ID, thread.player2ID]) {
    if (!store.isRegisteredOwner(ownerPlayerId)) continue;
    store.appendChronicle({ gameId: parameters.gameID, ownerPlayerId, turn: row.Turn }, {
      turn: row.Turn,
      kind: 'private-message',
      text,
      evidenceRef: { kind: 'transcript', id: String(row.ID) },
      dedupeKey: `transcript:${row.ID}:${ownerPlayerId}`,
      scope: 'private',
      participantPlayerIds: [thread.player1ID, thread.player2ID],
    });
  }
}

/** Append a factual deal lifecycle row to both entitled civilization chronicles. */
export function appendDealFact(
  store: CivilizationMemoryStore,
  parameters: StrategistParameters,
  thread: EnvoyThread,
  rowId: number,
  turn: number,
  text: string,
): void {
  const participants = [thread.player1ID, thread.player2ID];
  for (const ownerPlayerId of participants) {
    if (!store.isRegisteredOwner(ownerPlayerId)) continue;
    store.appendChronicle({ gameId: parameters.gameID, ownerPlayerId, turn }, {
      turn,
      kind: 'deal',
      text: `Turn ${turn} · ${text}`,
      evidenceRef: { kind: 'deal', id: String(rowId) },
      dedupeKey: `deal:${rowId}:${ownerPlayerId}`,
      scope: 'private',
      participantPlayerIds: participants,
    });
  }
}

/** Append a factual strategic decision and rationale after a successful strategy tool call. */
export function appendStrategyFact(
  store: CivilizationMemoryStore,
  parameters: StrategistParameters,
  action: string,
  rationale: string,
  traceId?: string,
): void {
  const cleanRationale = rationale.trim();
  if (!cleanRationale || cleanRationale === '[skipped]') return;
  const name = participantName(parameters, parameters.playerID);
  const evidenceId = traceId ?? `${parameters.gameID}:${parameters.playerID}:${parameters.turn}:${action}`;
  store.appendChronicle({ gameId: parameters.gameID, ownerPlayerId: parameters.playerID, turn: parameters.turn }, {
    turn: parameters.turn,
    kind: 'strategy-action',
    text: `Turn ${parameters.turn} · ${name} chose ${action}. Rationale: ${cleanRationale}`,
    evidenceRef: { kind: 'wake', id: evidenceId },
    dedupeKey: `strategy:${evidenceId}:${parameters.playerID}`,
    scope: 'self',
  });
}

/** Append normalized event facts from a consolidated Civ event report. */
export function appendGameEventFacts(
  store: CivilizationMemoryStore,
  parameters: StrategistParameters,
  events: unknown,
): void {
  if (!events || typeof events !== 'object') return;
  for (const [turnKey, value] of Object.entries(events as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const eventTurn = Number(turnKey);
    for (const [index, event] of value.entries()) {
      const eventObject: Record<string, unknown> = event && typeof event === 'object' ? event as Record<string, unknown> : { value: event };
      const rawId = eventObject.ID ?? eventObject.EventID ?? eventObject.id;
      const id = rawId === undefined ? `${turnKey}:${index}:${JSON.stringify(event)}` : String(rawId);
      const text = JSON.stringify(event);
      if (text.length === 0) continue;
      store.appendChronicle({ gameId: parameters.gameID, ownerPlayerId: parameters.playerID, turn: Number.isFinite(eventTurn) ? eventTurn : parameters.turn }, {
        turn: Number.isFinite(eventTurn) ? eventTurn : parameters.turn,
        kind: 'game-event',
        text: `Turn ${Number.isFinite(eventTurn) ? eventTurn : parameters.turn} · game event: ${text.slice(0, 4000)}`,
        evidenceRef: { kind: 'game-event', id },
        dedupeKey: `game-event:${id}:${parameters.playerID}`,
        scope: 'game',
      });
    }
  }
}

/** Append one entitled social communication fact without interpreting its political meaning. */
export function appendSocialFact(
  store: CivilizationMemoryStore,
  parameters: StrategistParameters,
  fact: SocialCommittedFact,
): void {
  const turn = fact.turn ?? parameters.turn;
  const content = fact.message?.content ?? fact.content ?? 'A social event occurred.';
  const quoted = content.replace(/\s+/g, ' ').trim().slice(0, 4000);
  const speakerId = fact.message?.speakerActorId ?? fact.actorId;
  const speaker = socialParticipantName(parameters, speakerId);
  const recipients = [...new Set((fact.recipientActorIds ?? []).filter((actorId) => actorId !== speakerId).map((actorId) => socialParticipantName(parameters, actorId)))];
  const label = socialFactLabel(fact.kind);
  const location = fact.channelTitle ? ` · ${fact.channelTitle}` : '';
  const route = recipients.length > 0 ? `${speaker} → ${recipients.join(', ')}` : speaker;
  const text = fact.message ? `Turn ${turn} · ${label}${location} · ${route}: "${quoted}"` : `Turn ${turn} · ${label}${location} · ${speaker}: ${quoted}`;
  for (const actorId of fact.entitledActorIds) {
    if (actorId !== `civ-player-${parameters.playerID}`) continue;
    store.appendChronicle({ gameId: parameters.gameID, ownerPlayerId: parameters.playerID, turn }, {
      turn,
      kind: 'private-message',
      text,
      evidenceRef: { kind: 'wake', id: fact.message ? String(fact.message.id) : `${fact.kind}:${fact.channelId ?? 'none'}:${turn}` },
      dedupeKey: `social:${fact.kind}:${fact.eventId ?? fact.message?.id ?? `${fact.channelId ?? 'none'}:${turn}`}:${parameters.playerID}`,
      scope: fact.kind === 'world-message' ? 'game' : fact.kind.includes('group') ? 'group' : 'private',
    });
  }
}

/** Resolve one social actor identity through the owner's authoritative Civ state. */
function socialParticipantName(parameters: StrategistParameters, actorId: string): string {
  const match = /^civ-player-(\d+)$/.exec(actorId);
  return match ? participantName(parameters, Number(match[1])) : actorId;
}

/** Convert an internal social fact kind into factual model-facing wording. */
function socialFactLabel(kind: string): string {
  switch (kind) {
    case 'dm-message': return 'Private message';
    case 'world-message': return 'Public statement';
    case 'group-message': return 'Group message';
    case 'group-created': return 'Group created';
    case 'invitation-sent': return 'Group invitation sent';
    case 'invitation-received': return 'Group invitation received';
    case 'group-joined': return 'Joined group';
    case 'invitation-declined': return 'Declined group invitation';
    case 'group-left': return 'Left group';
    default: return kind;
  }
}
