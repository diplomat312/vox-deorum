import type { SocialActor } from '../../types.js';

export type CivControlMode = 'human' | 'llm' | 'native-vp' | 'observer';

/** Stable mapping between one social actor and one live Civ major-player seat. */
export interface CivActorBinding { sessionId: string; actorId: string; ordinal: number; gameId: string; playerId: number; teamId?: number; civilizationType: string; civilizationName: string; leaderType?: string; leaderName?: string; controlMode: CivControlMode; active: boolean; }

/** Live Civ seat data required to construct stable actor bindings. */
export interface CivSeat { playerId: number; civilizationType: string; civilizationName: string; leaderType?: string; leaderName?: string; teamId?: number; human?: boolean; nativeVpOnly?: boolean; observer?: boolean; knownPlayerIds?: number[]; }

/** Bind actors to live seats by explicit actor identity, never by seat position. */
export function bindCivActors(sessionId: string, gameId: string, actors: SocialActor[], seats: CivSeat[], actorSeatById: Record<string, number>): CivActorBinding[] {
  const seatById = new Map(seats.map((seat) => [seat.playerId, seat]));
  const assigned = actors.map((actor) => ({ actor, playerId: actorSeatById[actor.id], seat: seatById.get(actorSeatById[actor.id]) }));
  if (assigned.some((item) => !Number.isSafeInteger(item.playerId) || !item.seat)) throw new Error('Every social actor must map to a live Civ seat');
  if (new Set(assigned.map((item) => item.playerId)).size !== assigned.length) throw new Error('Each social actor must map to a distinct Civ seat');
  if (assigned.some((item) => item.seat!.nativeVpOnly && item.actor.control === 'model')) throw new Error('Native-VP-only Civ seats cannot be bound to a model SocialActor');
  return assigned.map(({ actor, playerId, seat }) => { const controlMode: CivControlMode = actor.control === 'human' ? 'human' : seat!.observer ? 'observer' : 'llm'; return { sessionId, actorId: actor.id, ordinal: actor.ordinal, gameId, playerId: playerId!, ...(seat!.teamId === undefined ? {} : { teamId: seat!.teamId }), civilizationType: seat!.civilizationType, civilizationName: seat!.civilizationName, ...(seat!.leaderType === undefined ? {} : { leaderType: seat!.leaderType }), ...(seat!.leaderName === undefined ? {} : { leaderName: seat!.leaderName }), controlMode, active: true }; });
}
