import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import ConfigDialog from '@/components/session/ConfigDialog.vue';
import type { StrategistSessionConfig } from '@/utils/types';
import { ButtonStub } from '../../../helpers/stubs.js';

const { api } = vi.hoisted(() => ({
  api: { getAgents: vi.fn(), getPacingInterruptions: vi.fn() },
}));

vi.mock('@/api/client', async importOriginal => ({ ...(await importOriginal<typeof import('@/api/client')>()), api }));

const DialogStub = defineComponent({
  props: ['visible'],
  emits: ['update:visible'],
  template: '<div><slot /><slot name="footer" /></div>',
});

const configWithMetadata: StrategistSessionConfig & { filename: string; updatedAt: string } = {
  name: 'starter',
  filename: 'starter.json',
  updatedAt: '2026-08-01T12:00:00.000Z',
  type: 'strategist',
  autoPlay: false,
  llmPlayers: { 1: { strategist: 'simple-strategist' } },
};

/** Mounts the advanced editor with its child controls replaced by simple slots. */
function mountDialog() {
  return mount(ConfigDialog, {
    props: { visible: false, mode: 'edit', config: configWithMetadata, configName: 'starter' },
    global: {
      stubs: {
        Dialog: DialogStub,
        Button: ButtonStub,
        Card: { template: '<div><slot name="content" /></div>' },
        InputText: true,
        Textarea: true,
        Checkbox: true,
        SessionRunControls: true,
        PlayerConfigEditor: true,
      },
    },
  });
}

describe('ConfigDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getAgents.mockResolvedValue({ agents: [] });
    api.getPacingInterruptions.mockResolvedValue({ interruptions: [] });
  });

  it('strips list transport metadata before saving an edited configuration', async () => {
    const wrapper = mountDialog();
    await wrapper.setProps({ visible: true });
    await flushPromises();

    const saveButton = wrapper.findAll('button').find(button => button.text() === 'Save');
    if (!saveButton) throw new Error('Missing Save button.');
    await saveButton.trigger('click');

    const saved = wrapper.emitted('save')?.[0]?.[1] as StrategistSessionConfig;
    expect(saved).not.toHaveProperty('filename');
    expect(saved).not.toHaveProperty('updatedAt');
    expect(saved.name).toBe('starter');
  });
});
