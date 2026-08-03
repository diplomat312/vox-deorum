import { describe, expect, it } from 'vitest';
import { buildSeats, describeConfig, type SetupAgent, type WizardAnswers, type WizardRole } from '@/utils/session-summary';
import type { StrategistSessionConfig } from '@/utils/types';

/** Builds one wizard answer fixture with override support. */
function answers(overrides: Partial<WizardAnswers> = {}): WizardAnswers {
  return {
    role: 'play', civCount: 8, agenticCount: 3, strategist: 'simple-strategist',
    pacing: { everyTurns: 5, interruption: 'importantEvents' }, ...overrides,
  };
}

/** Expands collapsed seat ranges so tests can verify complete coverage. */
function coveredSeats(config: StrategistSessionConfig, role: WizardRole): number[] {
  const summary = describeConfig(config, agents, {});
  const result: number[] = [];
  for (const row of summary.seatRows) {
    const [startText, endText = startText] = row.seats.split('-');
    const start = Number(startText);
    const end = Number(endText);
    for (let seat = start; seat <= end; seat++) result.push(seat);
  }
  expect(summary.role).toBe(role);
  return result;
}

const agents: SetupAgent[] = [
  { name: 'simple-strategist', displayName: 'Simple LLM Strategist', description: '', tags: ['strategist'], offeredInSetup: true },
  { name: 'simple-strategist-staffed', displayName: 'Staffed LLM Strategist', description: '', tags: ['strategist'], offeredInSetup: true, modelSize: 'small' },
];

describe('buildSeats', () => {
  it.each([
    ['play', 2], ['play', 4], ['play', 6], ['play', 8], ['play', 10], ['play', 12],
    ['watch', 2], ['watch', 4], ['watch', 6], ['watch', 8], ['watch', 10], ['watch', 12],
    ['direct', 2], ['direct', 4], ['direct', 6], ['direct', 8], ['direct', 10], ['direct', 12],
  ] as const)('creates complete summaries for %s with %i civilizations', (role, civCount) => {
    const llmPlayers = buildSeats(answers({ role, civCount, agenticCount: civCount }));
    const config: StrategistSessionConfig = {
      name: `${role}-${civCount}`, type: 'strategist', autoPlay: role !== 'play', llmPlayers,
    };
    const seats = coveredSeats(config, role);

    expect(seats).toEqual(Array.from({ length: civCount }, (_, seat) => seat));
    expect(Math.max(...seats)).toBe(civCount - 1);
    if (role === 'play') expect(llmPlayers[0]).toBeUndefined();
    else expect(Object.keys(llmPlayers).map(Number)).toEqual(Array.from({ length: civCount }, (_, seat) => seat));
    if (role === 'direct') expect(llmPlayers[civCount - 1]).toMatchObject({ strategist: 'human-strategist', mode: 'Flavor' });
  });

  it('rejects odd civilization counts rather than silently rounding them', () => {
    expect(() => buildSeats(answers({ civCount: 7 }))).toThrow('even number');
  });

  it('leaves the selected model only on agentic seats', () => {
    const seats = buildSeats(answers({ role: 'watch', civCount: 4, agenticCount: 2, modelId: 'openai/gpt-5-mini' }));
    expect(seats[0]?.llms).toEqual({ default: 'openai/gpt-5-mini' });
    expect(seats[1]?.llms).toEqual({ default: 'openai/gpt-5-mini' });
    expect(seats[2]).toEqual({ strategist: 'none-strategist' });
  });
});

describe('describeConfig', () => {
  it('synthesizes implicit human and Vox Populi AI rows before collapsing adjacent seats', () => {
    const config: StrategistSessionConfig = {
      name: 'sparse-play', type: 'strategist', autoPlay: false,
      llmPlayers: { 7: { strategist: 'simple-strategist' } },
    };

    expect(describeConfig(config, agents, { default: 'openai/gpt-5-mini' }).seatRows).toEqual([
      { seats: '0', role: 'You', style: 'None', model: 'None' },
      { seats: '1-6', role: 'Vox Populi AI', style: 'None', model: 'None' },
      { seats: '7', role: 'Agentic AI', style: 'Simple LLM Strategist', model: 'openai/gpt-5-mini' },
    ]);
  });

  it('uses the effective per-seat model and collapses only matching adjacent seats', () => {
    const config: StrategistSessionConfig = {
      name: 'mixed', type: 'strategist', autoPlay: true,
      llmPlayers: {
        0: { strategist: 'simple-strategist', llms: { default: 'seat-a' } },
        1: { strategist: 'simple-strategist', llms: { default: 'seat-a' } },
        2: { strategist: 'simple-strategist-staffed', llms: { default: 'seat-b' } },
        3: { strategist: 'none-strategist' },
      },
    };
    const summary = describeConfig(config, agents, {
      default: 'global-default', 'seat-a': 'openai/model-a', 'seat-b': { provider: 'openai', name: 'model-b' },
    });

    expect(summary).toMatchObject({ role: 'watch', civCount: 4, mapSize: 'Tiny', agenticCount: 3, styleLabel: '3 × mixed' });
    expect(summary.seatRows).toEqual([
      { seats: '0-1', role: 'Agentic AI', style: 'Simple LLM Strategist', model: 'openai/model-a' },
      { seats: '2', role: 'Agentic AI', style: 'Staffed LLM Strategist', model: 'openai/model-b' },
      { seats: '3', role: 'Vox Populi AI', style: 'None', model: 'None' },
    ]);
  });

  it('uses agent mappings before size aliases, then falls through the two-tier defaults', () => {
    const config: StrategistSessionConfig = {
      name: 'precedence', type: 'strategist', autoPlay: true,
      llmPlayers: { 0: { strategist: 'simple-strategist-staffed', llms: { default: 'seat-default', small: 'seat-small' } } },
    };

    expect(describeConfig(config, agents, {
      default: 'global-default', small: 'global-small', 'simple-strategist-staffed': 'global-agent',
    }).seatRows[0]?.model).toBe('global-agent');
    expect(describeConfig(config, agents, { default: 'global-default', small: 'global-small' }).seatRows[0]?.model).toBe('seat-small');
    expect(describeConfig({ ...config, llmPlayers: { 0: { strategist: 'simple-strategist-staffed', llms: { default: 'seat-default' } } } }, agents, { default: 'global-default', small: 'global-small' }).seatRows[0]?.model).toBe('global-small');
    expect(describeConfig({ ...config, llmPlayers: { 0: { strategist: 'simple-strategist-staffed', llms: { default: 'seat-default' } } } }, agents, { default: 'global-default' }).seatRows[0]?.model).toBe('seat-default');
  });

  it('renders compact honest pacing labels and detailed interruption wording', () => {
    const config: StrategistSessionConfig = {
      name: 'pace', type: 'strategist', autoPlay: true,
      llmPlayers: {
        0: { strategist: 'simple-strategist', pacing: { everyTurns: 5, interruption: 'importantEvents' } },
        1: { strategist: 'simple-strategist', pacing: { everyTurns: 5, interruption: 'importantEvents' } },
      },
    };
    expect(describeConfig(config, agents, {}).paceLabel).toBe('5t');
    expect(describeConfig(config, agents, {}).paceTooltip).toBe('Every 5 turns, and on important events');
    expect(describeConfig({ ...config, llmPlayers: { ...config.llmPlayers, 1: { strategist: 'simple-strategist', pacing: { everyTurns: 1, interruption: 'none' } } } }, agents, {}).paceLabel).toBe('mixed');
  });
});
