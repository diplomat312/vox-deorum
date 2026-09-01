import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import CivilizationMindsDialog from '@/components/session/CivilizationMindsDialog.vue';
import { api } from '@/api/client';
import { activeSessions } from '@/stores/telemetry';

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const stubs = {
  Dialog: {
    props: ['visible'],
    emits: ['update:visible', 'hide'],
    template: '<section><slot name="header" /><slot /></section>',
  },
  Button: {
    props: ['label'],
    emits: ['click'],
    template: '<button @click="$emit(\'click\')">{{ label }}</button>',
  },
  Tag: {
    props: ['value'],
    template: '<span class="tag">{{ value }}</span>',
  },
  ProgressSpinner: { template: '<span />' },
  AgentSelectDialog: { template: '<span />' },
};

const players = {
  '0': { Civilization: 'Rome', Leader: 'Augustus', Score: 100, IsMajor: true },
  '1': { Civilization: 'Greece', Leader: 'Pericles', Score: 90, IsMajor: true },
  '2': { Civilization: 'Egypt', Leader: 'Cleopatra', Score: 80, IsMajor: true },
};

const assignments = {
  0: { strategist: 'unified-mind-strategist', mind: 'unified-mind' as const, mindModel: 'openrouter/minimax-m3', diplomat: 'unified-mind-diplomat', negotiator: 'unified-mind-negotiator', configSlot: 0 },
  1: { strategist: 'simple-strategist', model: 'openrouter/mimo-v2.5', configSlot: 1 },
};

const spans = [
  {
    contextId: 'game-player-0', turn: 41, traceId: 'trace-1', spanId: 'wake-1', parentSpanId: null,
    name: 'agent.unified-mind-strategist', startTime: 1_000_000_000, endTime: 1_100_000_000,
    durationMs: 100, attributes: { 'mind.mode': 'unified-mind', 'mind.wake': 'strategic', 'mind.outcome': 'keep-status-quo', 'mind.model': 'openrouter/minimax-m3', 'usage.input_tokens': 12, 'usage.output_tokens': 8 }, statusCode: 1, statusMessage: null,
  },
  {
    contextId: 'game-player-0', turn: 42, traceId: 'trace-2', spanId: 'wake-2', parentSpanId: null,
    name: 'agent.unified-mind-diplomat', startTime: 2_000_000_000, endTime: 0,
    durationMs: 0, attributes: { 'mind.mode': 'unified-mind', 'mind.wake': 'diplomacy', 'mind.outcome': 'spoke', 'mind.model': 'openrouter/minimax-m3' }, statusCode: 0, statusMessage: null,
  },
] as never;

describe('CivilizationMindsDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    activeSessions.value = [];
    vi.spyOn(api, 'getPlayersSummary').mockResolvedValue({ players: players as never, assignments });
    vi.spyOn(api, 'getTelemetrySessions').mockResolvedValue({ sessions: [{ sessionId: 'game-player-0', playerID: '0' }] });
    vi.spyOn(api, 'getSessionSpans').mockResolvedValue({ spans });
  });

  it('shows unified, legacy, and native seats with authoritative wake state', async () => {
    const wrapper = mount(CivilizationMindsDialog, { props: { visible: false }, global: { stubs } });
    await wrapper.setProps({ visible: true });
    await flushPromises();

    expect(wrapper.text()).toContain('Civilization Minds');
    expect(wrapper.text()).toContain('Unified Civilization Mind');
    expect(wrapper.text()).toContain('MiniMax M3');
    expect(wrapper.text()).toContain('Reasoning');
    expect(wrapper.text()).toContain('Diplomacy · Turn 42');
    expect(wrapper.text()).toContain('Spoke');
    expect(wrapper.text()).toContain('Native Civ / Vox Populi');
  });

  it('opens one chronological inspector and keeps adapter names in collapsed details', async () => {
    const wrapper = mount(CivilizationMindsDialog, { props: { visible: false }, global: { stubs } });
    await wrapper.setProps({ visible: true });
    await flushPromises();

    await wrapper.findAll('button').find(button => button.text() === 'Open Mind')!.trigger('click');
    expect(wrapper.text()).toContain('Activity timeline');
    expect(wrapper.text()).toContain('Strategy');
    expect(wrapper.text()).toContain('Diplomacy');
    expect(wrapper.text()).toContain('Passed');
    expect(wrapper.text()).toContain('Open deals');
    expect(wrapper.find('details').exists()).toBe(true);
    expect(wrapper.find('details').attributes('open')).toBeUndefined();
  });
});
