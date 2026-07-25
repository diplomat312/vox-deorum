/** Tests for the thin registered Lua function transport tool. */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { bridgeManager, knowledgeManager } from '../../../src/server.js';
import createCallLuaFunctionTool from '../../../src/tools/general/call-lua-function.js';

const tool = createCallLuaFunctionTool();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('call-lua-function', () => {
  it('preserves the BridgeManager success response', async () => {
    const response = { success: true, result: { accepted: true } };
    const call = vi.spyOn(bridgeManager, 'callLuaFunction').mockResolvedValue(response as any);

    await expect(tool.execute({ Name: 'VoxDeorumDiploBegin', Args: [{ busy: false }] } as any)).resolves.toEqual(response);
    expect(call).toHaveBeenCalledWith('VoxDeorumDiploBegin', [{ busy: false }]);
  });

  it('returns DLL_DISCONNECTED unchanged', async () => {
    const response = { success: false, error: { code: 'DLL_DISCONNECTED', message: 'The Civilization V DLL is disconnected.' } };
    vi.spyOn(bridgeManager, 'callLuaFunction').mockResolvedValue(response as any);

    await expect(tool.execute({ Name: 'VoxDeorumDiploStatus', Args: [] } as any)).resolves.toEqual(response);
  });

  it('strips the DLL transport frame from its structured output', async () => {
    // What BridgeManager settles is the whole lua_response frame. Publishing `type` and
    // `id` put internal framing in a caller-facing contract, and when the output schema
    // still forbade extra keys it failed validation *after* the Lua call had already run
    // in the game — which the client then retried, re-executing the call each time.
    vi.spyOn(bridgeManager, 'callLuaFunction').mockResolvedValue(
      { type: 'lua_response', id: 'b8dfa317-df98-48d7-9050-b2f7ab6fb768', success: true, result: true } as any,
    );

    const output = await tool.execute({ Name: 'VoxDeorumDiploBegin', Args: [] } as any);

    expect(output).not.toHaveProperty('type');
    expect(output).not.toHaveProperty('id');
    expect(output).toEqual({ success: true, result: true });
  });

  it('rejects a guarded call before it reaches BridgeManager after a game switch', async () => {
    vi.spyOn(knowledgeManager, 'getGameId').mockReturnValue('active-game');
    const call = vi.spyOn(bridgeManager, 'callLuaFunction');

    await expect(
      tool.execute({ Name: 'VoxDeorumDiploAppend', Args: [], ExpectedGameID: 'previous-game' } as any)
    ).rejects.toThrow(/expected game previous-game, but active game is active-game/);
    expect(call).not.toHaveBeenCalled();
  });
});
