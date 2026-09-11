// The shapes a seat reads from, and the seam every state source implements.
// A recorded game and a live game both have to satisfy this interface, so the
// seat runtime never learns where its situation came from.

// One seat of a game, as the world knows it.
export interface SeatInfo {
  // Lowercase seat name used throughout the harness, for example "korea".
  seat: string;
  // Player index inside the game, or null when the source did not capture it.
  playerID: number | null;
  // The model session that played the seat, or null when the source did not
  // capture it. A recorded game carries one session per seat for the whole run.
  session: string | null;
}

// One tool call a seat made while taking its turn, kept exactly as recorded.
export interface RecordedToolCall {
  // The tool the seat called, for example "vox-civ_inspect".
  tool: string;
  // The arguments the seat passed.
  input: unknown;
  // What the tool returned, or null when it returned nothing.
  output: string | null;
  // The failure text when the call failed, otherwise null.
  error: string | null;
  // The recorded status, for example "completed".
  status: string | null;
}

// How a seat ended a turn.
export type DecisionKind = "commit" | "pass" | "none";

// Everything recorded about one seat's one turn.
export interface WorldTurn {
  // The game label shared by every turn in this world, for example "fresh4".
  game: string;
  // The seat this turn belongs to.
  seat: string;
  // The player index, or null when it was not recorded.
  playerID: number | null;
  // The game turn number.
  turn: number;
  // The session that played the seat, when known.
  session: string | null;
  // The observation handed to the model, exactly as it was sent.
  observation: string;
  // The tool calls the seat made during the turn.
  toolCalls: RecordedToolCall[];
  // The model's final visible text, when the source captured it.
  modelText: string | null;
  // How the turn ended.
  decision: DecisionKind;
}

// The state source a seat reads from. A recorded-game replay and a live game
// both implement this, which keeps the seat runtime independent of the source.
export interface World {
  // The game label every turn in this world shares.
  readonly game: string;
  // Every seat this world can play, in a stable order.
  seats(): SeatInfo[];
  // Every turn number held for one seat, ascending.
  turns(seat: string): number[];
  // The recorded turn for a seat, or null when the world does not hold it.
  turn(seat: string, turn: number): WorldTurn | null;
  // The observation for a seat at a turn. Throws when the world does not hold
  // it, because a seat must never silently play against missing state.
  observation(seat: string, turn: number): string;
}
