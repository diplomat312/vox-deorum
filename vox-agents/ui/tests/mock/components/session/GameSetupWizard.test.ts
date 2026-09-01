import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import GameSetupWizard from '@/components/session/GameSetupWizard.vue';
import type { LLMConfig } from '@/utils/types';
import type { SetupAgent } from '@/utils/session-summary';
import { ButtonStub, InputNumberStub, InputTextStub } from '../../../helpers/stubs.js';

const { api, confirm } = vi.hoisted(() => ({
  api: { getPacingInterruptions: vi.fn(), getConfigModels: vi.fn(), saveSessionConfig: vi.fn() },
  confirm: { require: vi.fn() },
}));

vi.mock('@/api/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/api/client')>()), api }));
vi.mock('primevue/useconfirm', () => ({ useConfirm: () => confirm }));

const DialogStub = defineComponent({
  props: ['visible'],
  emits: ['update:visible'],
  template: '<div><header class="dialog-header"><slot name="header" /></header><main class="dialog-content"><slot /></main><footer><slot name="footer" /></footer></div>',
});
const SelectStub = defineComponent({
  props: ['modelValue', 'options', 'optionLabel', 'optionValue', 'optionGroupLabel', 'optionGroupChildren'], emits: ['update:modelValue'],
  template: '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><template v-for="option in options" :key="option[optionValue] ?? option[optionGroupLabel]"><optgroup v-if="optionGroupChildren && option[optionGroupChildren]" :label="option[optionGroupLabel]"><option v-for="child in option[optionGroupChildren]" :key="child[optionValue]" :value="child[optionValue]">{{ child[optionLabel] }}</option></optgroup><option v-else :value="option[optionValue]">{{ option[optionLabel] }}</option></template></select>',
});
const SliderStub = defineComponent({
  props: ['modelValue', 'min', 'max', 'step', 'ariaLabelledby'], emits: ['update:modelValue'],
  template: '<input type="range" :value="modelValue" :min="min" :max="max" :step="step" :aria-labelledby="ariaLabelledby" @input="$emit(\'update:modelValue\', Number($event.target.value))">',
});

const agents: SetupAgent[] = [
  { name: 'simple-strategist', displayName: 'Simple LLM Strategist', description: '', tags: ['strategist'], modelSize: 'default', offeredInSetup: true },
  { name: 'unified-mind-strategist', displayName: 'Unified Civilization Mind (internal)', description: '', tags: ['strategist'], modelSize: 'default', offeredInSetup: false },
  { name: 'hidden-strategist', displayName: 'Hidden', description: '', tags: ['strategist'], modelSize: 'default', offeredInSetup: false },
  { name: 'simple-strategist-staffed', displayName: 'Staffed LLM Strategist', description: '', tags: ['strategist'], modelSize: 'small', offeredInSetup: true },
];

/** Mounts the visible setup wizard with shared test stubs. */
function mountWizard() {
  return mount(GameSetupWizard, {
    props: {
      visible: true,
      agents,
      agentsLoading: false,
      agentsError: null,
      globalLlms: {} as Record<string, LLMConfig | string>,
      existingConfigNames: [],
    },
    global: { stubs: { Dialog: DialogStub, Button: ButtonStub, InputNumber: InputNumberStub, InputText: InputTextStub, Select: SelectStub, Slider: SliderStub } },
  });
}

/** Clicks a wizard button by its label. */
async function click(wrapper: ReturnType<typeof mount>, label: string): Promise<void> {
  const button = wrapper.findAll('.p-btn').find(candidate => candidate.text() === label);
  if (!button) throw new Error(`Missing ${label} button.`);
  await button.trigger('click');
}

describe('GameSetupWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getPacingInterruptions.mockResolvedValue({ interruptions: [{ name: 'importantEvents', label: 'Important events' }, { name: 'none', label: 'None' }] });
    api.getConfigModels.mockResolvedValue({ defaultModel: { id: 'openai/gpt-5-mini', provider: 'openai', name: 'gpt-5-mini' }, models: [{ id: 'openai/gpt-5', provider: 'openai', name: 'gpt-5' }, { id: 'openrouter/gpt-5', provider: 'openrouter', name: 'gpt-5' }], failures: [] });
    api.saveSessionConfig.mockResolvedValue({ filename: 'my-first-game.json' });
  });

  it('uses the four steps and loads choice catalogues when minds opens', async () => {
    const wrapper = mountWizard();

    expect(wrapper.get('.dialog-header .setup-wizard-progress').text()).toContain('1. Your role');
    expect(wrapper.find('.dialog-content .setup-wizard-progress').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Set up a game');
    await click(wrapper, 'Next');
    await click(wrapper, 'Next');
    await flushPromises();

    expect(wrapper.text()).toContain('How should the agentic AI civilizations be governed?');
    expect(api.getPacingInterruptions).toHaveBeenCalledOnce();
    expect(api.getConfigModels).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('Unified Civilization Mind');
    expect(wrapper.text()).toContain('Civilization model');
    expect(wrapper.text()).not.toContain('Unified Civilization Mind (internal)');
    expect(wrapper.find('select').text()).not.toContain('Hidden');
    expect(wrapper.find('#wizard-model').text()).toContain('gpt-5');
    expect(wrapper.find('#wizard-model').findAll('optgroup').map(group => group.attributes('label'))).toEqual(['openai', 'openrouter']);
  });

  it('keeps model choices when pacing choices fail', async () => {
    api.getPacingInterruptions.mockRejectedValue(new Error('Pacing registry is unavailable.'));
    const wrapper = mountWizard();
    await click(wrapper, 'Next');
    await click(wrapper, 'Next');
    await flushPromises();
    await wrapper.find('input[value="legacy"]').setValue(true);

    expect(wrapper.find('#wizard-model').text()).toContain('gpt-5');
    expect(wrapper.text()).toContain('Pacing choices could not be loaded.');
    expect(wrapper.text()).toContain('Pacing registry is unavailable.');
  });

  it('keeps Important events when model choices fail', async () => {
    api.getConfigModels.mockRejectedValue(new Error('Model catalogue is unavailable.'));
    const wrapper = mountWizard();
    await click(wrapper, 'Next');
    await click(wrapper, 'Next');
    await flushPromises();
    await wrapper.find('input[value="legacy"]').setValue(true);

    expect(wrapper.find('#wizard-interruption').text()).toContain('Important events');
    expect(wrapper.text()).toContain('Model choices could not be loaded.');
    await click(wrapper, 'Next');
    await click(wrapper, 'Save only');
    await flushPromises();
    expect(api.saveSessionConfig.mock.calls[0]?.[1].llmPlayers[1].pacing.interruption).toBe('importantEvents');
  });

  it('keeps the resolved pacing default when the wizard reopens with cached choices', async () => {
    const wrapper = mountWizard();
    await click(wrapper, 'Next');
    await click(wrapper, 'Next');
    await flushPromises();
    expect((wrapper.get('#wizard-interruption').element as HTMLSelectElement).value).toBe('importantEvents');

    await wrapper.setProps({ visible: false });
    await wrapper.setProps({ visible: true });
    await click(wrapper, 'Next');
    await click(wrapper, 'Next');
    await flushPromises();

    expect((wrapper.get('#wizard-interruption').element as HTMLSelectElement).value).toBe('importantEvents');
    expect(api.getPacingInterruptions).toHaveBeenCalledOnce();
  });

  it('groups role radios and offers recovery when setup styles are unavailable', async () => {
    const wrapper = mount(GameSetupWizard, {
      props: {
        visible: true,
        agents: [],
        agentsLoading: false,
        agentsError: 'The agent catalogue is unavailable.',
        globalLlms: {} as Record<string, LLMConfig | string>,
        existingConfigNames: [],
      },
      global: { stubs: { Dialog: DialogStub, Button: ButtonStub, InputNumber: InputNumberStub, InputText: InputTextStub, Select: SelectStub, Slider: SliderStub } },
    });

    expect(wrapper.get('fieldset legend').text()).toBe('Choose your role');
    expect(wrapper.findAll('input[type="radio"]').every(input => input.attributes('name') === 'wizard-role')).toBe(true);
    await click(wrapper, 'Next');
    await click(wrapper, 'Next');
    await wrapper.find('input[value="legacy"]').setValue(true);
    expect(wrapper.text()).toContain('Game setup styles could not be loaded.');
    await click(wrapper, 'Retry styles');
    await click(wrapper, 'Open Advanced Configuration');
    expect(wrapper.emitted('retryAgents')).toHaveLength(1);
    expect(wrapper.emitted('advanced')).toHaveLength(1);

    await wrapper.setProps({ agents, agentsError: null });
    expect(wrapper.findAll('.p-btn').find(button => button.text() === 'Next')?.attributes('disabled')).toBeUndefined();
  });

  it('uses sliders for civilization counts and protects the direct seat', async () => {
    const wrapper = mountWizard();
    await wrapper.find('input[value="direct"]').setValue(true);
    await click(wrapper, 'Next');
    const civs = wrapper.find('#wizard-civs');
    const agentic = wrapper.find('#wizard-agentic');
    expect(civs.attributes('min')).toBe('2');
    expect(civs.attributes('max')).toBe('12');
    expect(civs.attributes('step')).toBe('2');
    expect(agentic.attributes('min')).toBe('1');
    expect(agentic.attributes('max')).toBe('7');
    expect(agentic.attributes('step')).toBe('1');
    expect(civs.attributes('aria-labelledby')).toBe('wizard-civs-label');
    expect(agentic.attributes('aria-labelledby')).toBe('wizard-agentic-label');
    await civs.setValue('8');
    await agentic.setValue('7');
    await click(wrapper, 'Next');
    await flushPromises();
    await click(wrapper, 'Next');
    await wrapper.find('#wizard-name').setValue('direct-game');
    await click(wrapper, 'Save only');
    await flushPromises();

    const config = api.saveSessionConfig.mock.calls[0]?.[1];
    expect(config.llmPlayers[7]).toMatchObject({ strategist: 'human-strategist' });
    expect(Object.keys(config.llmPlayers)).toHaveLength(8);
  });

  it('writes no model override for My default and only llms.default for an explicit model', async () => {
    const wrapper = mountWizard();
    await click(wrapper, 'Next');
    await click(wrapper, 'Next');
    await flushPromises();
    await wrapper.find('input[value="legacy"]').setValue(true);
    await click(wrapper, 'Next');
    await click(wrapper, 'Save only');
    await flushPromises();
    expect(api.saveSessionConfig.mock.calls[0]?.[1].llmPlayers[1].llms).toBeUndefined();

    const explicit = mountWizard();
    await click(explicit, 'Next');
    await click(explicit, 'Next');
    await flushPromises();
    await explicit.find('input[value="legacy"]').setValue(true);
    await explicit.find('#wizard-model').setValue('openai/gpt-5');
    await click(explicit, 'Next');
    await click(explicit, 'Save only');
    await flushPromises();
    expect(api.saveSessionConfig.mock.calls[1]?.[1].llmPlayers[1].llms).toEqual({ default: 'openai/gpt-5' });
  });

  it('emits saved with the requested post-save action', async () => {
    const wrapper = mountWizard();
    await click(wrapper, 'Next');
    await click(wrapper, 'Next');
    await flushPromises();
    await click(wrapper, 'Next');
    await click(wrapper, 'Save & Play');
    await flushPromises();

    expect(wrapper.emitted('saved')?.[0]?.[1]).toBe(true);
    expect(wrapper.emitted('update:visible')).toContainEqual([false]);
  });

  it('renders the live seat preview plus the shared confirmation table and generated file', async () => {
    const wrapper = mountWizard();
    await click(wrapper, 'Next');
    expect(wrapper.text()).toContain('Seat');
    expect(wrapper.text()).toContain('You');
    expect(wrapper.text()).toContain('Agentic AI');
    expect(wrapper.text()).toContain('Vox Populi AI');
    expect(wrapper.get('[role="table"][aria-label="Game seats"]')).toBeTruthy();

    await click(wrapper, 'Next');
    await flushPromises();
    await click(wrapper, 'Next');

    expect(wrapper.text()).toContain('View file');
    expect(wrapper.text()).toContain('"llmPlayers"');
    expect(wrapper.text()).not.toContain('3 × Simple LLM Strategist. Every 5 turns, and on important events.');
  });

  it('uses the server-canonical filename when emitting the saved configuration', async () => {
    api.saveSessionConfig.mockResolvedValue({ filename: 'my_first_game.json' });
    const wrapper = mountWizard();
    await click(wrapper, 'Next');
    await click(wrapper, 'Next');
    await flushPromises();
    await click(wrapper, 'Next');
    await click(wrapper, 'Save only');
    await flushPromises();

    expect(wrapper.emitted('saved')?.[0]?.[0]).toMatchObject({ name: 'my_first_game' });
  });

  it('requires confirmation before replacing an existing configuration', async () => {
    const wrapper = mount(GameSetupWizard, {
      props: {
        visible: true,
        agents,
        agentsLoading: false,
        agentsError: null,
        globalLlms: {} as Record<string, LLMConfig | string>,
        existingConfigNames: ['MY-FIRST-GAME'],
      },
      global: { stubs: { Dialog: DialogStub, Button: ButtonStub, InputNumber: InputNumberStub, InputText: InputTextStub, Select: SelectStub, Slider: SliderStub } },
    });
    await click(wrapper, 'Next');
    await click(wrapper, 'Next');
    await flushPromises();
    await click(wrapper, 'Next');
    await click(wrapper, 'Save only');

    expect(api.saveSessionConfig).not.toHaveBeenCalled();
    expect(confirm.require).toHaveBeenCalledWith(expect.objectContaining({
      header: 'Replace Configuration',
      acceptLabel: 'Replace',
    }));

    const confirmation = confirm.require.mock.calls[0]?.[0];
    confirmation.accept();
    await flushPromises();
    expect(api.saveSessionConfig).toHaveBeenCalledOnce();
  });

  it('blocks a fractional count before it can preview or save a different configuration', async () => {
    const wrapper = mountWizard();
    await click(wrapper, 'Next');
    await wrapper.find('#wizard-agentic').setValue('2.5');

    expect(wrapper.text()).toContain('Agentic AI must be a whole number');
    expect(wrapper.findAll('.p-btn').find(button => button.text() === 'Next')?.attributes('disabled')).toBeDefined();
    await click(wrapper, 'Next');
    expect(wrapper.text()).toContain('Who is in the game?');
    expect(api.saveSessionConfig).not.toHaveBeenCalled();
  });
});
