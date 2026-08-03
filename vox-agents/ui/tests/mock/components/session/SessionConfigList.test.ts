import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import type { DirectiveBinding } from 'vue';
import SessionConfigList from '@/components/session/SessionConfigList.vue';
import type { AgentInfo, SessionConfigEntry, VoxAgentsConfig } from '@/utils/types';
import { ButtonStub, TagStub, ToolbarStub } from '../../../helpers/stubs.js';

const agents: AgentInfo[] = [
  { name: 'simple-strategist', displayName: 'Simple LLM Strategist', description: 'A direct strategist', tags: ['strategist'], modelSize: 'default' },
  { name: 'none-strategist', displayName: 'Vox Populi AI', description: 'The Civ V AI', tags: ['strategist'], modelSize: 'default' },
];

const globalLlms: VoxAgentsConfig['llms'] = {
  default: 'openai/gpt-5-mini',
};

/** Exposes tooltip bindings as DOM attributes so the compact pace copy is testable. */
const tooltipDirective = {
  mounted(element: HTMLElement, binding: DirectiveBinding<string>) {
    element.setAttribute('data-tooltip', binding.value);
  },
};

const stubs = {
  Toolbar: ToolbarStub,
  Tag: TagStub,
  Button: ButtonStub,
  InputText: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template: '<input class="search-input" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
  },
  Select: {
    props: ['modelValue', 'options'],
    emits: ['update:modelValue'],
    template: '<select class="sort-select" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option></select>',
  },
  Menu: {
    props: ['model'],
    methods: { toggle: () => undefined },
    template: '<div class="action-menu"><template v-for="item in model" :key="item.label"><button v-if="!item.separator" @click="item.command">{{ item.label }}</button></template></div>',
  },
  Message: {
    template: '<div class="p-message"><slot /></div>',
  },
  ProgressSpinner: {
    template: '<div class="p-spinner" />',
  },
};

/** Build a config fixture with complete session-list metadata. */
function makeConfig(name = 'standard-game'): SessionConfigEntry {
  return {
    name,
    type: 'strategist',
    autoPlay: false,
    filename: `${name}.json`,
    updatedAt: '2026-08-01T12:00:00.000Z',
    llmPlayers: {
      1: { strategist: 'simple-strategist', pacing: { everyTurns: 5, interruption: 'importantEvents' } },
      2: { strategist: 'simple-strategist', pacing: { everyTurns: 5, interruption: 'importantEvents' } },
      3: { strategist: 'none-strategist' },
    },
  };
}

/** Mount the list with defaults for non-rendering state props. */
function mountList(configs: readonly SessionConfigEntry[]) {
  return mount(SessionConfigList, {
    props: {
      configs,
      agents,
      globalLlms,
      loading: false,
      error: null,
      sessionActive: false,
      startingSession: false,
      highlightedConfigName: null,
    },
    global: {
      stubs,
      directives: { tooltip: tooltipDirective },
    },
  });
}

describe('SessionConfigList', () => {
  it('renders player-facing session columns from the shared summary', () => {
    const wrapper = mountList([{ ...makeConfig(), autoPlay: true, repetition: 3 }]);

    expect(wrapper.text()).toContain('standard-game');
    expect(wrapper.text()).toContain('Watch ×3');
    expect(wrapper.text()).toContain('Tiny');
    expect(wrapper.text()).toContain('2 × Simple LLM Strategist');
    expect(wrapper.text()).toContain('5t');
    expect(wrapper.findAll('.col-fixed-80').find(cell => cell.text() === '5t')?.attributes('data-tooltip'))
      .toBe('Every 5 turns, and on important events');
  });

  it('expands the per-seat summary, shows the saved file shape, and runs metadata-free overflow actions', async () => {
    const config = makeConfig();
    const { filename: _filename, updatedAt: _updatedAt, ...plainConfig } = config;
    const wrapper = mountList([config]);

    await wrapper.get('button[data-icon="pi pi-chevron-right"]').trigger('click');
    expect(wrapper.text()).toContain('Seat');
    expect(wrapper.text()).toContain('1-2');
    expect(wrapper.text()).toContain('Updated');
    expect(wrapper.get('[role="table"][aria-label="Seats in standard-game"]')).toBeTruthy();

    await wrapper.get('button[data-icon="pi pi-ellipsis-v"]').trigger('click');
    await wrapper.get('.action-menu button').trigger('click');

    expect(wrapper.emitted('edit')?.[0]).toEqual([plainConfig]);

    await wrapper.get('button[data-icon="pi pi-ellipsis-v"]').trigger('click');
    await wrapper.findAll('.action-menu button')[1]!.trigger('click');
    expect(wrapper.emitted('duplicate')?.[0]).toEqual([plainConfig]);

    await wrapper.get('button[data-icon="pi pi-ellipsis-v"]').trigger('click');
    await wrapper.findAll('.action-menu button')[2]!.trigger('click');
    expect(wrapper.get('.table-config-file pre').text()).toContain('standard-game');
    expect(wrapper.get('.table-config-file pre').text()).not.toContain('filename');
    expect(wrapper.get('.table-config-file pre').text()).not.toContain('updatedAt');
  });

  it('emits the selected configuration when starting a row', async () => {
    const config = makeConfig();
    const { filename: _filename, updatedAt: _updatedAt, ...plainConfig } = config;
    const wrapper = mountList([config]);

    await wrapper.get('button[data-icon="pi pi-play"]').trigger('click');

    expect(wrapper.emitted('start')?.[0]).toEqual([plainConfig]);
  });

  it('labels icon-only session actions for screen readers', () => {
    const wrapper = mountList([makeConfig()]);

    expect(wrapper.get('button[data-icon="pi pi-play"]').attributes('aria-label')).toBe('Start session');
    expect(wrapper.get('button[data-icon="pi pi-ellipsis-v"]').attributes('aria-label')).toBe('Configuration actions');
  });

  it('exposes table semantics and expandable row state to assistive technology', async () => {
    const wrapper = mountList([makeConfig()]);
    const expander = wrapper.get('button[data-icon="pi pi-chevron-right"]');

    expect(wrapper.get('[role="table"]').attributes('aria-label')).toBe('Game configurations');
    expect(expander.attributes('aria-expanded')).toBe('false');
    expect(expander.attributes('aria-label')).toBe('Show details for standard-game');
    await expander.trigger('click');
    expect(wrapper.get('button[data-icon="pi pi-chevron-down"]').attributes('aria-expanded')).toBe('true');
    expect(wrapper.get('button[data-icon="pi pi-chevron-down"]').attributes('aria-label')).toBe('Hide details for standard-game');
    expect(wrapper.get('[id="config-details-standard-game.json"]').attributes('role')).toBe('row');
  });

  it('uses a DOM-safe detail ID when a saved filename contains spaces and punctuation', async () => {
    const config = { ...makeConfig('My game!'), filename: 'My game!.json' };
    const wrapper = mountList([config]);
    const expander = wrapper.get('button[data-icon="pi pi-chevron-right"]');
    const detailId = expander.attributes('aria-controls');

    expect(detailId).toBe('config-details-My%20game!.json');
    expect(detailId).not.toMatch(/\s/);
    await expander.trigger('click');
    expect(wrapper.get(`[id="${detailId}"]`).attributes('role')).toBe('row');
  });

  it('filters by description after the search input changes', async () => {
    vi.useFakeTimers();
    const matching = { ...makeConfig('cooperative-game'), description: 'A diplomacy experiment' };
    const wrapper = mountList([makeConfig(), matching]);

    await wrapper.get('.search-input').setValue('diplomacy');
    await vi.advanceTimersByTimeAsync(300);

    expect(wrapper.text()).toContain('cooperative-game');
    expect(wrapper.text()).not.toContain('standard-game');
  });

  it('emits create from the empty state', async () => {
    const wrapper = mountList([]);

    await wrapper.get('button[data-icon="pi pi-plus"]').trigger('click');

    expect(wrapper.emitted('create')).toHaveLength(1);
  });
});

afterEach(() => {
  vi.useRealTimers();
});
