// Observation builder. Turn 1 is fuller; later turns are dashboard + diff.
// The identity block is byte-identical every turn (cache-friendly prefix).
export function identityBlock(civ, leader) {
  return `You are ${leader}, leader of ${civ}. You are playing Civilization V. Advance your civilization's interests and try to win. You will periodically receive information about the current game and events that occurred. You may inspect additional information when useful and choose actions for your civilization. Your prior conversations, decisions, promises, threats, and political behavior are your own history. Continue coherently from them.`;
}

export function buildObservation({ civ, leader, turn, state, outstanding = [] }) {
  const head = `TURN ${turn}`;
  if (turn <= 1) {
    return `${head}\n\nCurrent:\n- Treasury: ${state.treasury}\n- Happiness: ${state.happiness}\n- Research: ${state.research}\n- Current wars: ${state.wars.length ? state.wars.join(", ") : "none"}\n- Strategic posture: ${state.posture}\n- Cities: ${state.cities.join(", ")}\n\nSince game start:\n${state.events.map((e) => `- ${e}`).join("\n")}\n\nYou may inspect anything else you need (inspect). When finished, commit your actions (commit_turn) or pass.`;
  }
  const changes = state.events.map((e) => `- ${e}`).join("\n");
  const reqs = outstanding.length
    ? `\n\nOutstanding requests/deals/messages:\n${outstanding.map((o) => `- ${o}`).join("\n")}`
    : "";
  return `${head}\n\nCurrent:\n- Treasury: ${state.treasury}\n- Happiness: ${state.happiness}\n- Research: ${state.research}\n- Current wars: ${state.wars.length ? state.wars.join(", ") : "none"}\n- Strategic posture: ${state.posture}${reqs}\n\nSince your previous opportunity to act:\n${changes}\n\nYou may inspect anything else you need. When finished, commit your actions.`;
}

export function buildDiploAppend({ from, turn, message, facts = [] }) {
  const f = facts.length ? `\n\nRelevant current facts:\n${facts.map((x) => `- ${x}`).join("\n")}` : "";
  return `TURN ${turn} — PRIVATE MESSAGE FROM ${from}\n\n"${message}"${f}\n\nRespond or take any other permitted political action if warranted. Use communicate if enabled; otherwise account for it in your next commit_turn rationale.`;
}
