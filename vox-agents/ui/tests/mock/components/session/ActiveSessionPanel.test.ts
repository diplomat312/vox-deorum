import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ActiveSessionPanel from '@/components/session/ActiveSessionPanel.vue';
import type { SessionStatus, StrategistSessionConfig } from '@/utils/types';
import { ButtonStub, TagStub, ToolbarStub } from '../../../helpers/stubs.js';

/** Build a strategist configuration for the active session fixture. */
function makeConfig(): StrategistSessionConfig {
  return {
    name: 'test-config',
    type: 'strategist',
    autoPlay: true,
    gameMode: 'start',
    repetition: 2,
    llmPlayers: {},
  };
}

/** Build an active session fixture with optional status overrides. */
function makeSession(overrides: Partial<SessionStatus> = {}): SessionStatus {
  return {
    id: 'session-1',
    type: 'strategist',
    state: 'running',
    config: makeConfig(),
    startTime: new Date(Date.now() - 65_000),
    gameID: 'game-1',
    turn: 42,
    ...overrides,
  };
}

describe('ActiveSessionPanel', () => {
  it('renders elapsed time and swaps Pause for Resume when paused', () => {
    const wrapper = mount(ActiveSessionPanel, {
      props: { session: makeSession({ paused: true }), loading: false },
      global: { stubs: { Toolbar: ToolbarStub, Tag: TagStub, Button: ButtonStub } },
    });

    expect(wrapper.text()).toContain('PAUSED');
    expect(wrapper.text()).toContain('1m 5s');
    expect(wrapper.get('button[data-icon="pi pi-play"]').text()).toBe('Resume');
  });

  it('labels the player view as Civilization Minds and shows the unified count', () => {
    const wrapper = mount(ActiveSessionPanel, {
      props: { session: makeSession(), loading: false, unifiedMindCount: 4 },
      global: { stubs: { Toolbar: ToolbarStub, Tag: TagStub, Button: ButtonStub } },
    });

    expect(wrapper.text()).toContain('Civilization Minds');
    expect(wrapper.text()).toContain('4 UNIFIED MINDS');
  });
});
