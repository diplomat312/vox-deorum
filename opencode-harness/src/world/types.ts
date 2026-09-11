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

// What a world answered when a seat asked to see something.
export interface InspectAnswer {
  // The text handed back to the seat.
  text: string;
  // True when the world could not answer, which is recorded as a gap. What
  // seats keep asking for and not getting is the sharpest signal about what
  // the observation should carry, so an empty answer is a fact, not an error.
  gap?: boolean;
}

// The state source a seat reads from. A simulated game, a recorded-game replay
// and, later, a live game all implement this, which keeps the seat runtime
// independent of where its situation came from.
export interface World {
  // The game label every turn in this world shares.
  readonly game: string;
  // Every seat this world can play, in a stable order.
  seats(): SeatInfo[];
  // Prepare a seat to be shown its turn. A simulated world advances to the
  // turn here and delivers whatever arrived for that seat, so rendering the
  // observation afterwards can be a plain read.
  beginTurn(seat: string, turn: number): Promise<void>;
  // Whether a seat has a turn to play at this number.
  hasTurn(seat: string, turn: number): boolean;
  // The observation for a seat at a turn. Throws when the world cannot produce
  // it, because a seat must never silently play against missing state.
  //
  // A live or simulated world may advance that seat's diplomacy cursor as a
  // side effect, because rendering the observation is how messages are
  // delivered to a seat.
  observation(seat: string, turn: number): string;
  // Answer one inspect. A world that does not hold the answer says so rather
  // than inventing state.
  inspect(seat: string, turn: number, subject: string, detail?: string): Promise<InspectAnswer>;
}
