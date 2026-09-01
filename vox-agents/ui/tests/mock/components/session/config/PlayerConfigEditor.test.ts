import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import PlayerConfigEditor from '@/components/session/config/PlayerConfigEditor.vue';
import type { PlayerConfig, SelectOption } from '@/utils/types';

const CardStub = defineComponent({ template: '<div><slot name="title" /><slot name="content" /></div>' });
const ButtonStub = defineComponent({ props: ['label', 'icon'], template: '<button><slot />{{ label }}</button>' });
const InputNumberStub = defineComponent({ props: ['modelValue', 'id'], emits: ['update:modelValue'], template: '<input :id="id" :value="modelValue">' });
const DropdownStub = defineComponent({
  props: ['modelValue', 'options', 'optionLabel', 'optionValue', 'id'],
  emits: ['update:modelValue'],
  template: '<select :id="id" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="option in options" :key="option[optionValue]" :value="option[optionValue]">{{ option[optionLabel] }}</option></select>',
});

const strategistOptions: SelectOption<string>[] = [{ label: 'Simple LLM Strategist', value: 'simple-strategist' }];
const modelOptions: SelectOption<string>[] = [{ label: 'Muse Spark', value: 'openrouter/muse-spark' }];

/** Mount the advanced player editor with deterministic form stubs. */
function mountEditor(players: Record<number, PlayerConfig>) {
  return mount(PlayerConfigEditor, {
    props: {
      players,
      autoPlay: true,
      strategistOptions,
      modelOptions,
      interruptionOptions: [{ label: 'None', value: 'none' }],
      loadingStrategists: false,
      loadingModels: false,
      loadingInterruptions: false,
    },
    global: { stubs: { Card: CardStub, Button: ButtonStub, Dropdown: DropdownStub, InputNumber: InputNumberStub } },
  });
}

describe('PlayerConfigEditor unified architecture', () => {
  it('switches a legacy seat to a unified seat with an explicit model', async () => {
    const wrapper = mountEditor({ 0: { strategist: 'simple-strategist', llms: { default: 'old-model' }, pacing: { everyTurns: 2, interruption: 'none' } } });

    await wrapper.get('#architecture-0').setValue('unified');
    const updates = wrapper.emitted('update:players') ?? [];
    const updated = updates[updates.length - 1]?.[0] as Record<number, PlayerConfig>;

    expect(updated[0]).toMatchObject({ strategist: 'simple-strategist', mind: 'unified-mind' });
    expect(updated[0]?.llms).toMatchObject({ default: 'old-model', 'unified-mind': 'openrouter/muse-spark' });
  });

  it('switches a unified seat back to legacy without leaving unified mode active', async () => {
    const wrapper = mountEditor({ 0: {
      strategist: 'simple-strategist', mind: 'unified-mind',
      llms: { 'unified-mind': 'openrouter/muse-spark', default: 'legacy-model' },
      pacing: { everyTurns: 2, interruption: 'none' },
    } });

    await wrapper.get('#architecture-0').setValue('legacy');
    const updates = wrapper.emitted('update:players') ?? [];
    const updated = updates[updates.length - 1]?.[0] as Record<number, PlayerConfig>;

    expect(updated[0]).not.toHaveProperty('mind');
    expect(updated[0]?.llms).toEqual({ default: 'legacy-model' });
    expect(wrapper.text()).toContain('Unified Civilization Mind');
    expect(wrapper.text()).not.toContain('unified-mind-strategist');
  });
});
