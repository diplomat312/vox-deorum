import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import PlayersSummaryDialog from '@/components/session/PlayersSummaryDialog.vue';
import { api } from '@/api/client';

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const stubs = {
  Dialog: {
    props: ['visible'],
    emits: ['update:visible', 'hide'],
    template: '<section><slot name="header" /><slot /></section>'
  },
  ProgressSpinner: {
    template: '<span />'
  },
  AgentSelectDialog: {
    template: '<span />'
  },
};

beforeEach(() => {
  vi.useFakeTimers();
});

describe('PlayersSummaryDialog', () => {
  it('loads the canonical civilization-mind read model and releases polling when closed', async () => {
    const mindsRequest = vi.spyOn(api, 'getCivilizationMinds').mockResolvedValue({ minds: [] });
    const wrapper = mount(PlayersSummaryDialog, {
      props: { visible: false },
      global: { stubs }
    });

    await wrapper.setProps({ visible: true });
    await flushPromises();
    expect(mindsRequest).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Civilization Minds');

    await wrapper.setProps({ visible: false });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mindsRequest).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });
});
