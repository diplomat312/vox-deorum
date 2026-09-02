import type { SocialActor } from '../../types.js';
import type { CivEnvironmentAdapter } from './civ-environment-adapter.js';

/** Build compact Civ facts for the existing social context layer. */
export class CivContextProvider {
  public constructor(private readonly adapter: CivEnvironmentAdapter) {}
  /** Return stable identity and bounded normalized state without raw game objects. */
  public async forActor(actor: SocialActor): Promise<string> { const snapshot = await this.adapter.snapshot(); const binding = this.adapter.binding(actor.id); return JSON.stringify({ environment: snapshot.environment, gameId: snapshot.gameId, turn: snapshot.turn, civilization: binding.civilizationName, leader: binding.leaderName, controlMode: binding.controlMode, state: snapshot.normalizedState, rule: 'Conversation claims are not mechanical proof; formal deals and game actions require authoritative game readback.' }); }
}
