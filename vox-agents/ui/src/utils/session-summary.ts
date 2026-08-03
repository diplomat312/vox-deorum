/** Pure session-wizard seat generation and configuration summary helpers. */

import type { AgentInfo, LLMConfig, StrategistSessionConfig } from '@/utils/types';

/** The roles offered by the game setup wizard. */
export type WizardRole = 'play' | 'watch' | 'direct';

/** An agent shape with the setup metadata supplied by the agent catalogue. */
export type SetupAgent = AgentInfo;

/** Values collected by the game setup wizard before a config is saved. */
export interface WizardAnswers {
  role: WizardRole;
  civCount: number;
  agenticCount: number;
  strategist: string;
  pacing: { everyTurns: number; interruption: string };
  modelId?: string;
  name?: string;
  description?: string;
}

/** A seat row shared by the list expander and wizard confirmation. */
export interface SeatRow {
  seats: string;
  role: 'You' | 'Agentic AI' | 'Vox Populi AI';
  style: string;
  model: string;
}

/** The player-facing facts derived from a session configuration. */
export interface ConfigSummary {
  role: WizardRole;
  civCount: number;
  mapSize: string;
  agenticCount: number;
  styleLabel: string;
  paceLabel: string;
  paceTooltip: string;
  sentence: string;
  seatRows: SeatRow[];
}

/** Rejects invalid civilization counts instead of silently changing the player's choice. */
function assertSupportedCivCount(civCount: number): void {
  if (!Number.isInteger(civCount) || civCount < 2 || civCount > 12 || civCount % 2 !== 0) {
    throw new Error('Civilization count must be an even number from 2 through 12.');
  }
}

/** Rejects agentic counts that the launcher cannot represent exactly. */
function assertSupportedAgenticCount(agenticCount: number, role: WizardRole, civCount: number): void {
  const limit = agenticLimit(role, civCount);
  if (!Number.isInteger(agenticCount) || agenticCount < 1 || agenticCount > limit) {
    throw new Error(`Agentic AI count must be a whole number from 1 through ${limit}.`);
  }
}

/** Rejects pacing intervals that would otherwise be normalized by the game runtime. */
function assertSupportedPacing(everyTurns: number): void {
  if (!Number.isInteger(everyTurns) || everyTurns < 1) {
    throw new Error('Decision pacing must be a positive whole number of turns.');
  }
}

/** Limits the number of agentic seats without replacing the direct-control seat. */
function agenticLimit(role: WizardRole, civCount: number): number {
  return role === 'direct' ? civCount - 1 : role === 'play' ? civCount - 1 : civCount;
}

/** Builds a contiguous inclusive seat label. */
function seatLabel(start: number, end: number): string {
  return start === end ? `${start}` : `${start}-${end}`;
}

/** Finds the map size used by the Civilization launcher for a player count. */
function mapSizeFor(civCount: number): string {
  if (civCount <= 2) return 'Duel';
  if (civCount <= 4) return 'Tiny';
  if (civCount <= 6) return 'Small';
  if (civCount <= 8) return 'Standard';
  if (civCount <= 10) return 'Large';
  return 'Huge';
}

/** Resolves one alias chain from seat definitions before the global definitions. */
function resolveModel(reference: string, seatLlms: Record<string, LLMConfig | string>, globalLlms: Record<string, LLMConfig | string>): string {
  const visited = new Set<string>();
  let current = reference;
  while (!visited.has(current)) {
    visited.add(current);
    const value = seatLlms[current] ?? globalLlms[current];
    if (value === undefined) return current;
    if (typeof value !== 'string') return `${value.provider}/${value.name}`;
    current = value;
  }
  return reference;
}

/** Chooses a strategist model using the backend's agent then size precedence. */
function strategistModel(player: { strategist: string; llms?: Record<string, LLMConfig | string> }, agents: readonly SetupAgent[], globalLlms: Record<string, LLMConfig | string>): string {
  const seatLlms = player.llms ?? {};
  const size = agents.find(agent => agent.name === player.strategist)?.modelSize ?? 'default';
  const reference = seatLlms[player.strategist] !== undefined ? player.strategist
    : globalLlms[player.strategist] !== undefined ? player.strategist
      : seatLlms[size] !== undefined ? size
        : globalLlms[size] !== undefined ? size : 'default';
  return resolveModel(reference, seatLlms, globalLlms);
}

/** Gets the catalogue label for a strategist name. */
function agentLabel(name: string, agents: readonly SetupAgent[]): string {
  return agents.find(agent => agent.name === name)?.displayName ?? name;
}

/** Converts one configured interruption into player-facing pace wording. */
function interruptionLabel(interruption: string | undefined): string {
  if (!interruption || interruption === 'none') return '';
  if (interruption === 'importantEvents') return ', and on important events';
  return `, and on ${interruption}`;
}

/** Describes one shared agentic pacing setting in a complete sentence. */
function paceDescription(pacing: { everyTurns?: number; interruption?: string }): string {
  const cadence = pacing.everyTurns === 1 ? 'Every turn' : `Every ${pacing.everyTurns ?? 1} turns`;
  return `${cadence}${interruptionLabel(pacing.interruption)}`;
}

/** Generates the complete, contiguous player map required by the session wizard. */
export function buildSeats(answers: WizardAnswers): StrategistSessionConfig['llmPlayers'] {
  assertSupportedCivCount(answers.civCount);
  const civCount = answers.civCount;
  assertSupportedAgenticCount(answers.agenticCount, answers.role, civCount);
  assertSupportedPacing(answers.pacing.everyTurns);
  const count = answers.agenticCount;
  const firstAgenticSeat = answers.role === 'play' ? 1 : 0;
  const lastAgenticSeat = firstAgenticSeat + count - 1;
  const players: StrategistSessionConfig['llmPlayers'] = {};

  for (let seat = firstAgenticSeat; seat < civCount; seat++) {
    const isDirectSeat = answers.role === 'direct' && seat === civCount - 1;
    const isAgenticSeat = seat <= lastAgenticSeat && !isDirectSeat;
    players[seat] = isDirectSeat
      ? { strategist: 'human-strategist', mode: 'Flavor', pacing: { ...answers.pacing } }
      : isAgenticSeat
        ? {
          strategist: answers.strategist,
          pacing: { ...answers.pacing },
          ...(answers.modelId ? { llms: { default: answers.modelId } } : {})
        }
        : { strategist: 'none-strategist' };
  }
  return players;
}

/** Describes a config with compact columns and collapsed adjacent seat rows. */
export function describeConfig(config: StrategistSessionConfig, agents: readonly SetupAgent[], globalLlms: Record<string, LLMConfig | string>): ConfigSummary {
  const configuredSeats = Object.keys(config.llmPlayers).map(Number).filter(Number.isInteger).sort((left, right) => left - right);
  const civCount = configuredSeats.length === 0 ? 0 : Math.max(...configuredSeats) + 1;
  const seats = Array.from({ length: civCount }, (_, seat) => seat);
  const role: WizardRole = Object.values(config.llmPlayers).some(player => player.strategist === 'human-strategist')
    ? 'direct' : config.autoPlay ? 'watch' : 'play';
  const agenticSeats = configuredSeats.filter(seat => {
    const strategist = config.llmPlayers[seat]?.strategist;
    return strategist !== 'none-strategist' && strategist !== 'human-strategist';
  });
  const styles = [...new Set(agenticSeats.map(seat => agentLabel(config.llmPlayers[seat]!.strategist, agents)))];
  const agenticCount = agenticSeats.length;
  const pacings = agenticSeats.map(seat => config.llmPlayers[seat]?.pacing ?? { everyTurns: 1, interruption: 'none' });
  const firstPacing = pacings[0] ?? { everyTurns: 1, interruption: 'none' };
  const hasMixedPacing = pacings.some(pacing => pacing.everyTurns !== firstPacing.everyTurns || pacing.interruption !== firstPacing.interruption);
  const rawRows = seats.map((seat): Omit<SeatRow, 'seats'> & { seat: number } => {
    if (role === 'play' && seat === 0) return { seat, role: 'You', style: 'None', model: 'None' };
    const player = config.llmPlayers[seat];
    if (!player) return { seat, role: 'Vox Populi AI', style: 'None', model: 'None' };
    if (player.strategist === 'none-strategist') return { seat, role: 'Vox Populi AI', style: 'None', model: 'None' };
    if (player.strategist === 'human-strategist') return { seat, role: 'You', style: 'Direct', model: 'None' };
    return { seat, role: 'Agentic AI', style: agentLabel(player.strategist, agents), model: strategistModel(player, agents, globalLlms) };
  });
  const seatRows: SeatRow[] = [];
  for (const row of rawRows) {
    const previous = seatRows[seatRows.length - 1];
    const previousParts = previous?.seats.split('-');
    const previousEnd = previousParts?.[previousParts.length - 1];
    const canCollapse = previous && previous.role === row.role && previous.style === row.style && previous.model === row.model
      && Number(previousEnd) === row.seat - 1;
    if (canCollapse && previous) {
      previous.seats = seatLabel(Number(previous.seats.split('-')[0]), row.seat);
    } else {
      seatRows.push({ seats: `${row.seat}`, role: row.role, style: row.style, model: row.model });
    }
  }
  const styleLabel = agenticCount === 0 ? 'None' : styles.length === 1 ? `${agenticCount} × ${styles[0]}` : `${agenticCount} × mixed`;
  const paceLabel = agenticCount === 0 ? 'None' : hasMixedPacing ? 'mixed' : `${firstPacing.everyTurns ?? 1}t`;
  const paceTooltip = agenticCount === 0
    ? 'No agentic AI civilizations'
    : hasMixedPacing
      ? 'Agentic AI civilizations use mixed decision pacing.'
      : paceDescription(firstPacing);
  const subject = role === 'play' ? `You play 1 of ${civCount} civilizations.` : role === 'direct' ? `You direct 1 of ${civCount} civilizations.` : `${civCount} civilizations play themselves.`;
  const agenticSentence = agenticCount === 0
    ? 'There are no agentic AI civilizations.'
    : hasMixedPacing
      ? `${agenticCount} civilizations are agentic AI with mixed decision pacing.`
      : `${agenticCount} civilizations are agentic AI and re-think ${paceTooltip.charAt(0).toLowerCase()}${paceTooltip.slice(1)}.`;
  return { role, civCount, mapSize: mapSizeFor(civCount), agenticCount, styleLabel, paceLabel, paceTooltip, sentence: `${subject} ${agenticSentence}`, seatRows };
}
