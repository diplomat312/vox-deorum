import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import CivilizationMindsDialog from '@/components/session/CivilizationMindsDialog.vue';
import { api } from '@/api/client';

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

const minds = [
  { playerId: 0, civilization: 'Rome', leader: 'Augustus', architecture: 'unified-mind', model: 'openrouter/minimax-m3', runtimeContextId: 'game-player-0', activity: { activeWakes: [{ runId: 'run-1', wake: 'diplomacy', startedAt: 2_000 }] }, game: { score: 100, activeAgreementCount: 0 }, memory: { outlook: { gameId: 'g', ownerPlayerId: 0, text: 'Repair Greece ties', revision: 1, createdTurn: 1, updatedTurn: 2 }, recentChronicle: [], recentChronicleTokenCount: 0, maintenanceRequired: false }, recentWakes: [{ wake: 'strategic', turn: 41, outcome: 'keep-status-quo', model: 'openrouter/minimax-m3', durationMs: 100, tokens: { input: 12, output: 8 }, timestamp: 1_000, traceId: 'trace-1', spanId: 'wake-1' }, { wake: 'diplomacy', turn: 42, outcome: 'spoke', model: 'openrouter/minimax-m3', durationMs: 100, tokens: {}, timestamp: 2_000, traceId: 'trace-2', spanId: 'wake-2' }] },
  { playerId: 1, civilization: 'Greece', leader: 'Pericles', architecture: 'legacy', model: 'openrouter/mimo-v2.5', activity: { activeWakes: [] }, game: { score: 90, activeAgreementCount: 0 }, recentWakes: [] },
  { playerId: 2, civilization: 'Egypt', leader: 'Cleopatra', architecture: 'native', activity: { activeWakes: [] }, game: { score: 80, activeAgreementCount: 0 }, recentWakes: [] },
];

describe('CivilizationMindsDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(api, 'getCivilizationMinds').mockResolvedValue({ minds: minds as never });
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
    expect(wrapper.text()).toContain('Active agreements');
    expect(wrapper.find('details').exists()).toBe(true);
    expect(wrapper.find('details').attributes('open')).toBeUndefined();
    expect(wrapper.text()).toContain('Civilization continuity');
    expect(wrapper.text()).toContain('Current Outlook');
    expect(wrapper.text()).toContain('Repair Greece ties');
  });
});
