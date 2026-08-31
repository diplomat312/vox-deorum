/** A normalized environment snapshot that can be safely attached to a social session. */
export interface EnvironmentSnapshot { environment: string; gameId: string; turn: number; facts: Record<string, string | number | boolean>; }

/** A typed, game-independent environment adapter seam for the social player-mind. */
export interface EnvironmentAdapter<TSnapshot extends EnvironmentSnapshot = EnvironmentSnapshot, TEvent extends EnvironmentEvent = EnvironmentEvent> {
  attach(sessionId: string, snapshot: TSnapshot): Promise<void>;
  snapshot(): Promise<TSnapshot>;
  ingest(event: TEvent): Promise<boolean>;
}

/** A reconstructable stimulus with stable provenance and no prescribed reaction. */
export interface EnvironmentEvent { gameId: string; turn: number; type: string; sourceKey: string; actorId?: string; sourcePlayerId?: number; targetPlayerId?: number; occurredAt?: string; payload: Record<string, string | number | boolean>; }
