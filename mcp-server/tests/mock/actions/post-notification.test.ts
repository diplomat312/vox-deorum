/**
 * Tests for the post-notification action tool. The Lua boundary is stubbed (no
 * bridge); we assert argument shaping, the CounterpartID default, IPC text
 * sanitization, participant validation, and the Success/Result passthrough.
 *
 * Stage 7.04 widened the recipient to the full addressable player range so a human watching from
 * an observer slot can be notified. The delivery-side half of that — the pinned-observer redirect —
 * lives in `lua/post-notification.lua` and needs live game state, which this tier cannot execute
 * (the repo has no Lua harness), so the last suite pins the script's guard structurally instead.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { LuaFunction } from '../../../src/bridge/lua-function.js';
import createPostNotificationTool from '../../../src/tools/actions/post-notification.js';
import { MaxMajorCivs, MaxPlayers } from '../../../src/knowledge/schema/base.js';

const tool = createPostNotificationTool();

afterEach(() => {
  vi.restoreAllMocks();
});

/** Stub the Lua boundary so super.call() returns a canned boolean result. */
function mockLua(result = true, success = true) {
  return vi.spyOn(LuaFunction.prototype, 'execute').mockResolvedValue({ success, result } as any);
}

describe('post-notification', () => {
  it('forwards a diplomacy notification with the counterpart and maps Success/Result', async () => {
    const spy = mockLua(true);

    const result = await tool.execute({
      PlayerID: 0, CounterpartID: 3, Summary: 'Napoleon writes', Message: 'We should talk.',
    } as any);

    expect(result.Success).toBe(true);
    expect(result.Result).toBe(true);
    expect(spy).toHaveBeenCalledWith(0, 3, 'Napoleon writes', 'We should talk.');
  });

  it('defaults CounterpartID to -1 when omitted (general message path)', async () => {
    const spy = mockLua(true);

    await tool.execute({
      PlayerID: 2, Summary: 'Notice', Message: 'The council has news.',
    } as any);

    expect(spy).toHaveBeenCalledWith(2, -1, 'Notice', 'The council has news.');
  });

  it('trims text and strips the IPC frame delimiter from Summary and Message', async () => {
    const spy = mockLua(true);

    await tool.execute({
      PlayerID: 1,
      Summary: '  head!@#$%^!line  ',
      Message: '  before!@#$%^!after  ',
    } as any);

    expect(spy).toHaveBeenCalledWith(1, -1, 'headline', 'beforeafter');
  });

  it('rejects a diplomacy notification addressed to the receiving player', async () => {
    const spy = mockLua(true);

    await expect(tool.execute({
      PlayerID: 1, CounterpartID: 1, Summary: 'Notice', Message: 'Message',
    } as any)).rejects.toThrow('CounterpartID must be different from PlayerID');
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ['Summary', '!@#$%^!', 'Message'],
    ['Message', 'Summary', '  \t\n  '],
  ])('rejects %s when sanitization leaves no visible text', async (field, summary, message) => {
    const spy = mockLua(true);

    await expect(tool.execute({
      PlayerID: 1, Summary: summary, Message: message,
    } as any)).rejects.toThrow(`${field} must contain visible text after IPC sanitization`);
    expect(spy).not.toHaveBeenCalled();
  });

  it('propagates a failed Lua response', async () => {
    mockLua(false, false);

    const result = await tool.execute({
      PlayerID: 0, Summary: 's', Message: 'm',
    } as any);

    expect(result.Success).toBe(false);
  });

  it('preserves a Civ V rejection as a false result on a successful bridge call', async () => {
    mockLua(false, true);

    const result = await tool.execute({
      PlayerID: 0, Summary: 's', Message: 'm',
    } as any);

    expect(result.Success).toBe(true);
    expect(result.Result).toBe(false);
  });
});

describe('post-notification observer-capable recipient', () => {
  it('accepts an observer-slot PlayerID beyond the major-civ range', async () => {
    const spy = mockLua(true);

    // A pure observer's real slot sits above MaxMajorCivs; it is still a real Players[] entry and
    // a legitimate notification recipient, so the schema must admit it.
    const observerSlot = MaxMajorCivs + 5;
    expect(() => tool.inputSchema.parse({
      PlayerID: observerSlot, Summary: 's', Message: 'm',
    })).not.toThrow();

    await tool.execute({ PlayerID: observerSlot, Summary: 'Notice', Message: 'A reply arrived.' } as any);
    expect(spy).toHaveBeenCalledWith(observerSlot, -1, 'Notice', 'A reply arrived.');
  });

  it('bounds PlayerID at the full player range and CounterpartID at the major civs', async () => {
    // The counterpart is a conversation partner, so it stays a major civilization even though the
    // recipient no longer has to be one.
    expect(() => tool.inputSchema.parse({ PlayerID: MaxPlayers - 1, Summary: 's', Message: 'm' })).not.toThrow();
    expect(() => tool.inputSchema.parse({ PlayerID: MaxPlayers, Summary: 's', Message: 'm' })).toThrow();
    expect(() => tool.inputSchema.parse({ PlayerID: -1, Summary: 's', Message: 'm' })).toThrow();
    expect(() => tool.inputSchema.parse({
      PlayerID: 0, CounterpartID: MaxMajorCivs, Summary: 's', Message: 'm',
    })).toThrow();
  });
});

describe('post-notification pinned-observer redirect (Lua guard)', () => {
  // CvNotifications::Add only DISPLAYS a notification whose recipient is the active player, so a
  // human strategist (an observer pinned to a civ seat) would never see one addressed to that
  // seat. The script redirects it to the observer — but only under all three guard conditions, so
  // a pure observer keeps its own slot and normal seated play is untouched. There is no Lua test
  // harness in this repo, so this asserts the guard's shape rather than running it.
  const script = readFileSync('lua/post-notification.lua', 'utf-8');

  it('redirects only when the active player is an observer whose UI override is the requested seat', () => {
    // All three conditions, and the redirect they gate, are present.
    expect(script).toMatch(/activeID\s*~=\s*targetID/);
    expect(script).toMatch(/IsObserver\(\)/);
    expect(script).toMatch(/GetObserverUIOverridePlayer\(\)/);
    expect(script).toMatch(/overrideID\s*==\s*targetID/);
    expect(script).toMatch(/targetID\s*=\s*activeID/);
  });

  it('defaults to the requested recipient and nil-guards every lookup so odd state falls through', () => {
    // targetID starts as the requested playerID: any guard that does not hold leaves it there,
    // which is exactly the normal-play and pure-observer behaviour.
    expect(script).toMatch(/local\s+targetID\s*=\s*playerID/);
    expect(script).toMatch(/local\s+player\s*=\s*Players\[targetID\]/);
    // Each game lookup is pcall'd and nil-checked, so a stock DLL without these bindings degrades
    // to the requested recipient instead of erroring the whole notification. The two numeric reads
    // share one pcall-guarded reader; IsObserver is guarded at its own call site.
    expect(script).toMatch(/local function readNumber\(fn\)\s*\n\s*local ok, value = pcall\(fn\)/);
    expect(script).toMatch(/readNumber\(function\(\) return Game\.GetActivePlayer\(\) end\)/);
    expect(script).toMatch(/readNumber\(function\(\) return Game\.GetObserverUIOverridePlayer\(\) end\)/);
    expect(script).toMatch(/pcall\(function\(\) return activePlayer:IsObserver\(\) end\)/);
    expect(script).toMatch(/activeID\s*~=\s*nil/);
    expect(script).toMatch(/activePlayer\s*~=\s*nil/);
    expect(script).toMatch(/overrideID\s*~=\s*nil/);
  });
});
