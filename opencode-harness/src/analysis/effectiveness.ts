// Whether the talking changed anything in the world.
//
// Quantity and quality both measure the conversation. Effectiveness asks the
// harder question: did a seat's words become a game action, and did the action
// outlive the turn it happened on? A table that talks beautifully and changes
// nothing is a worse outcome than a table that says less and means it.
//
// The evidence comes from what the seats actually did, which the trace keeps as
// the arguments of their commit calls. Nothing here is inferred from wording.

import type { TraceRecord } from "../trace/types.js";

// One game action a seat asked for.
export interface ActionRecord {
  // The seat that asked.
  seat: string;
  // The turn it asked on.
  turn: number;
  // The kind of action, such as research, policy or posture.
  type: string;
  // The seat it was aimed at, for a posture action, as a player index.
  target: number | null;
}

// What the seats' actions amounted to.
export interface EffectivenessMetrics {
  // Every action committed, in the order committed.
  actions: ActionRecord[];
  // How many of each kind of action was committed.
  byType: Record<string, number>;
  // Posture actions, which are diplomacy expressed as a game action. A table
  // that talks about relationships but never sets one is talking without
  // consequence, so this is the measure that matters most here.
  postures: number;
  // Turns on which a seat changed how it regards someone.
  turnsWithPosture: number;
  // Seats that never set a posture, which is a seat that kept its opinion to
  // itself.
  seatsWithoutPosture: string[];
  // The share of seat turns that ended in a game action rather than only in
  // words or a pass.
  actionRate: number;
  // Consequential turns, meaning turns whose actions changed something lasting
  // rather than restating the position.
  consequential: number;
}

// Read the actions a seat asked for out of one commit call.
function actionsOf(record: TraceRecord): ActionRecord[] {
  const actions: ActionRecord[] = [];
  for (const call of record.toolCalls) {
    const tool = call.tool.replace(/^vox-civ_/, "");
    if (tool !== "commit_turn") continue;
    const input = (call.input ?? {}) as Record<string, unknown>;
    if (!Array.isArray(input.actions)) continue;
    for (const entry of input.actions) {
      if (typeof entry !== "object" || entry === null) continue;
      const action = entry as Record<string, unknown>;
      const type = typeof action.type === "string" ? action.type : "unknown";
      actions.push({
        seat: record.seat,
        turn: record.turn,
        type,
        target: typeof action.target === "number" ? action.target : null
      });
    }
  }
  return actions;
}

// Work out what the seats' actions amounted to.
export function effectivenessMetrics(records: TraceRecord[], seats: string[]): EffectivenessMetrics {
  const actions: ActionRecord[] = [];
  for (const record of records) actions.push(...actionsOf(record));
  const byType: Record<string, number> = {};
  for (const action of actions) byType[action.type] = (byType[action.type] ?? 0) + 1;

  // A posture is diplomacy with a consequence, so it is counted separately.
  const postureActions = actions.filter((action) => action.type === "posture");
  const postureTurns = new Set(postureActions.map((action) => action.seat + ":" + action.turn));
  const seatsWithPosture = new Set(postureActions.map((action) => action.seat));

  // A turn is consequential when it changed something lasting: a posture, a
  // strategy, a policy or a technology. Research counts because it commits the
  // seat's science for several turns, while keeping the status quo does not.
  const lasts: string[] = ["posture", "strategy", "policy", "research"];
  const consequential = records.filter((record) =>
    actionsOf(record).some((action) => lasts.includes(action.type))
  ).length;

  return {
    actions,
    byType,
    postures: postureActions.length,
    turnsWithPosture: postureTurns.size,
    seatsWithoutPosture: seats.filter((seat) => !seatsWithPosture.has(seat)),
    actionRate: records.length === 0 ? 0 : consequential / records.length,
    consequential
  };
}
