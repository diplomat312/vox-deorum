// The state source for a recorded game, and the fixture a seat plays against
// while the real game stays closed. Tests build one from literal turns, and
// the benchmark builds one from the harvested corpus. Both are the same class,
// because a recorded game and a hand-written scenario differ only in where
// their turns came from.

import { loadCorpusDirectory } from "./corpus.js";
import type { SeatInfo, World, WorldTurn } from "./types.js";

// Serves a fixed set of recorded turns, indexed by seat and turn number.
export class RecordedWorld implements World {
  // The game label every turn must share.
  readonly game: string;

  // Seats in the order they were first seen, so the same input always produces
  // the same seat list.
  private readonly seatList: SeatInfo[];

  // Turns indexed by seat and then by turn number.
  private readonly bySeat: Map<string, Map<number, WorldTurn>>;

  // Index the given turns. A world needs at least one turn, and every turn must
  // belong to the same game, because a seat plays one game at a time.
  constructor(turns: WorldTurn[]) {
    if (turns.length === 0) {
      throw new Error("A world needs at least one recorded turn");
    }
    const game = turns[0].game;
    const bySeat = new Map<string, Map<number, WorldTurn>>();
    const seats: SeatInfo[] = [];
    for (const turn of turns) {
      if (turn.game !== game) {
        throw new Error(
          "Every turn in a world must share one game label, found '" + turn.game + "' and '" + game + "'"
        );
      }
      let seatTurns = bySeat.get(turn.seat);
      if (!seatTurns) {
        seatTurns = new Map<number, WorldTurn>();
        bySeat.set(turn.seat, seatTurns);
        seats.push({ seat: turn.seat, playerID: turn.playerID, session: turn.session });
      }
      seatTurns.set(turn.turn, turn);
    }
    this.game = game;
    this.seatList = seats;
    this.bySeat = bySeat;
  }

  // Build a world from a harvested corpus directory.
  static async fromDirectory(directory: string): Promise<RecordedWorld> {
    const corpus = await loadCorpusDirectory(directory);
    const turns: WorldTurn[] = [];
    for (const seatTurns of corpus.values()) {
      turns.push(...seatTurns);
    }
    return new RecordedWorld(turns);
  }

  // The seats this world can play, as copies so callers cannot mutate the index.
  seats(): SeatInfo[] {
    return this.seatList.map((seat) => ({ ...seat }));
  }

  // The turns held for a seat, ascending. An unknown seat holds none.
  turns(seat: string): number[] {
    const seatTurns = this.bySeat.get(seat);
    if (!seatTurns) return [];
    return [...seatTurns.keys()].sort((left, right) => left - right);
  }

  // One recorded turn, or null when the world does not hold it.
  turn(seat: string, turn: number): WorldTurn | null {
    return this.bySeat.get(seat)?.get(turn) ?? null;
  }

  // The observation for a seat at a turn. Missing state stops the caller rather
  // than handing a seat an empty situation.
  observation(seat: string, turn: number): string {
    const record = this.turn(seat, turn);
    if (!record) {
      throw new Error(
        "No recorded turn for seat '" + seat + "' at turn " + turn + " in game '" + this.game + "'"
      );
    }
    return record.observation;
  }
}
