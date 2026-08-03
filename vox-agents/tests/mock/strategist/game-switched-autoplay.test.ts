/**
 * Tests for StrategistSession's autoplay reconciliation on game switch and
 * crash recovery (src/strategist/strategist-session.ts). Civ V serializes the
 * autoplay counter and slot statuses into saves, so handleGameSwitched must
 * align the engine with the session config in both directions: an interactive
 * (autoPlay: false) session loading/taking over an auto-playing game cancels
 * autoplay and hands seat 0 to the human; an autoplay session loading a human
 * save activates autoplay. The turn-0 fresh-start activation is unchanged.
 *
 * Driven entirely through the shared mcpClient fixture; vox-civilization is
 * mocked and timers are made instant.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installMockMcpClient, textResult, structuredResult } from '../../helpers/mock-mcp-client.js';

const modelMocks = vi.hoisted(() => ({
  ensureModelsResolved: vi.fn(async () => undefined),
  selectModelReference: vi.fn(),
}));

vi.mock('../../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

vi.mock('../../../src/infra/vox-civilization.js', () => ({
  voxCivilization: {
    onGameExit: vi.fn(),
    killGame: vi.fn(async () => {}),
    restoreRandomSeeds: vi.fn(async () => {}),
    updateSkipAnimations: vi.fn(async () => {}),
    setAiObserver: vi.fn(),
    startGame: vi.fn(async () => false),
  },
}));

vi.mock('../../../src/utils/models/resolution.js', () => ({
  ensureModelsResolved: modelMocks.ensureModelsResolved,
  selectModelReference: modelMocks.selectModelReference,
}));

// Make the session's settle waits instant (post-player-creation and strategic-view delays).
vi.mock('node:timers/promises', () => ({ setTimeout: () => Promise.resolve() }));

import { StrategistSession } from '../../../src/strategist/strategist-session.js';
import { agentRegistry } from '../../../src/infra/agent-registry.js';
import { voxCivilization } from '../../../src/infra/vox-civilization.js';
import {
  autoPlayTurnLimit,
  buildStrategicViewLua,
} from '../../../src/utils/game/control-lua.js';

let mcp: ReturnType<typeof installMockMcpClient>;
beforeEach(() => {
  mcp = installMockMcpClient();
  modelMocks.ensureModelsResolved.mockClear();
  modelMocks.selectModelReference.mockReset();
  mcp.respondWith('set-metadata', textResult(true));
  mcp.respondWith('pause-game', textResult(true));
  mcp.respondWith('lua-executor', structuredResult({ Success: true }));
});

/**
 * Construct a session past the start() ceremony: production 'none' no-ops all
 * OBS paths, an empty llmPlayers map skips VoxPlayer creation, and a seedless
 * claim short-circuits seed verification. handleGameSwitched bails while
 * 'stopped', so tests begin from 'starting' as a real launch would.
 */
function session(autoPlay: boolean) {
  const config = {
    name: 'test',
    type: 'strategist',
    production: 'none',
    autoPlay,
    gameMode: 'start',
    llmPlayers: {},
  } as any;
  const manager = { attachGameID: vi.fn(async () => {}) } as any;
  const claim = { seatingMap: {}, rotation: 0, seedIndex: 0 } as any;
  const s = new StrategistSession(config, manager, claim);
  (s as any).state = 'starting';
  return s;
}

const gameSwitched = (s: StrategistSession, turn: number, gameID = 'G1') =>
  (s as any).handleGameSwitched({ gameID, turn }) as Promise<void>;

const luaScripts = () => mcp.calls('lua-executor').map((c) => String(c.args.Script));

describe('handleGameSwitched autoplay reconciliation', () => {
  it('interactive load/takeover: clears the override, cancels autoplay, returns seat 0', async () => {
    const s = session(false);
    await gameSwitched(s, 214);

    const scripts = luaScripts();
    expect(scripts).toHaveLength(1);
    const script = scripts[0];
    // Override (cleared — no human-strategist seat) must precede LoadScreenClose.
    expect(script.indexOf('Game.SetObserverUIOverridePlayer(-1)')).toBeGreaterThanOrEqual(0);
    expect(script.indexOf('Game.SetObserverUIOverridePlayer(-1)')).toBeLessThan(
      script.indexOf('Events.LoadScreenClose()')
    );
    expect(script).toContain('if Game.GetAIAutoPlay() > 0 then');
    expect(script).toContain('Game.SetAIAutoPlay(0, 0);');
    expect(script).toContain('elseif Game.GetActivePlayer() ~= 0 then');
    // Interactive sessions never enter strategic view.
    expect(script).not.toContain('ToggleStrategicView');
  });

  it('autoplay load: activates autoplay only if the save has it off, then enters strategic view', async () => {
    const s = session(true);
    await gameSwitched(s, 214);

    const scripts = luaScripts();
    expect(scripts).toHaveLength(2);
    expect(scripts[0]).toContain('if Game.GetAIAutoPlay() == 0 then');
    expect(scripts[0]).toContain(`Game.SetAIAutoPlay(${autoPlayTurnLimit}, -1);`);
    expect(scripts[1]).toBe(buildStrategicViewLua(false));
  });

  it('autoplay fresh start (turn 0): activates autoplay and enters strategic view', async () => {
    const s = session(true);
    await gameSwitched(s, 0);

    const scripts = luaScripts();
    expect(scripts[0]).toContain(`Game.SetAIAutoPlay(${autoPlayTurnLimit}, -1);`);
    // The turn-0 branch activates unconditionally — no reconcile guard.
    expect(scripts[0]).not.toContain('if Game.GetAIAutoPlay()');
    expect(scripts[1]).toBe(buildStrategicViewLua(true));
  });

  it('ignores a repeated GameSwitched for the same game', async () => {
    const s = session(false);
    await gameSwitched(s, 214);
    const before = mcp.calls('lua-executor').length;

    await gameSwitched(s, 215);
    expect(mcp.calls('lua-executor')).toHaveLength(before);
  });
});

describe('model preflight', () => {
  it('uses strategist metadata to preflight the selected reference, not every seat override', async () => {
    const overrides = { default: 'openai/selected', 'unused-agent': 'openai/unused' };
    modelMocks.selectModelReference.mockReturnValue('openai/selected');
    vi.spyOn(agentRegistry, 'get').mockReturnValue({ modelSize: 'small' } as never);
    vi.mocked(voxCivilization.startGame).mockResolvedValue(false);

    const s = new StrategistSession({
      name: 'preflight',
      type: 'strategist',
      autoPlay: false,
      gameMode: 'start',
      llmPlayers: { 0: { strategist: 'selected-strategist', llms: overrides } },
    }, {} as never, null);

    await expect(s.start()).rejects.toThrow('Failed to start Civilization V');

    expect(modelMocks.selectModelReference).toHaveBeenCalledWith('selected-strategist', 'small', overrides);
    expect(modelMocks.ensureModelsResolved).toHaveBeenCalledWith(['openai/selected'], overrides);
  });
});

describe('recoverGame', () => {
  it('re-issues the unified non-fresh transition after a crash relaunch', async () => {
    const s = session(false);
    (s as any).state = 'recovering';
    await (s as any).recoverGame();

    const scripts = luaScripts();
    expect(scripts).toHaveLength(1);
    const script = scripts[0];
    // Same ordering invariant as handleGameSwitched: override before
    // LoadScreenClose (the mod's screen-bar gate re-evaluates on that event),
    // autoplay reconcile last.
    expect(script.indexOf('Game.SetObserverUIOverridePlayer(-1)')).toBeGreaterThanOrEqual(0);
    expect(script.indexOf('Game.SetObserverUIOverridePlayer(-1)')).toBeLessThan(
      script.indexOf('Events.LoadScreenClose()')
    );
    expect(script).toContain('Game.SetAIAutoPlay(0, 0);');
    expect((s as any).state).toBe('running');
  });

  it('is a no-op outside the recovering state', async () => {
    const s = session(false);
    await (s as any).recoverGame();
    expect(luaScripts()).toHaveLength(0);
  });
});

describe('handleDLLConnected', () => {
  it('should reset event dedup only once per disconnected-to-connected transition', async () => {
    const s = session(false);
    const resetEventDedup = vi.spyOn((s as any).ingameBridge, 'resetEventDedup');

    await (s as any).handleDLLConnected({});
    await (s as any).handleDLLConnected({});
    expect(resetEventDedup).toHaveBeenCalledOnce();

    (s as any).dllConnected = false;
    await (s as any).handleDLLConnected({});
    expect(resetEventDedup).toHaveBeenCalledTimes(2);
  });
});
