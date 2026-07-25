/**
 * Tests for the diplomat's close-conversation tool (src/envoy/close-conversation-tool.ts).
 * The close flows through the durable store via closeConversation → mcpClient.callTool
 * (reading the active proposal, retracting it if open, then writing the close), driven here by
 * the shared mcpClient fixture — no live server / game.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { installMockMcpClient, structuredResult } from '../../helpers/mock-mcp-client.js';
import type { EnvoyThread } from '../../../src/types/index.js';

vi.mock('../../../src/utils/models/mcp-client.js', async () => {
  const helper = await import('../../helpers/mock-mcp-client.js');
  return helper.mockMcpClientModule();
});

import { createCloseConversationTool } from '../../../src/envoy/close-conversation-tool.js';

let mcp: ReturnType<typeof installMockMcpClient>;
beforeEach(() => {
  mcp = installMockMcpClient();
  // closeConversation reads the transcript first to find any open proposal to retract; default to
  // none so the close-only tests exercise the plain close path.
  mcp.respondWith('read-transcript', structuredResult({ messages: [] }));
});

/** Active diplomacy thread the diplomat is voicing (agent = seat 3). */
function thread(partial: Partial<EnvoyThread> = {}): EnvoyThread {
  return {
    id: 'dipl:g:1:3',
    agent: 3,
    gameID: 'g',
    player1ID: 1,
    player2ID: 3,
    player1Role: 'the leader',
    player2Role: 'diplomat',
    contextType: 'live',
    contextId: 'g-player-3',
    messages: [],
    ...partial,
  };
}

/** Minimal VoxContext stub: the tool reads currentInput + currentParameters. */
function makeContext(currentInput: EnvoyThread | undefined) {
  return { id: 'ctx', currentInput, currentParameters: { turn: 5, playerID: 3 } } as any;
}

/** Run the tool's execute with the given active conversation. */
function close(currentInput: EnvoyThread | undefined, farewell = 'Farewell.') {
  const tool = createCloseConversationTool(makeContext(currentInput)) as any;
  return tool.execute({ Farewell: farewell }, { toolCallId: 't', messages: [] });
}

describe('close-conversation tool', () => {
  it('reports no active conversation when currentInput is missing', async () => {
    expect(await close(undefined)).toBe('No active conversation to close.');
    expect(mcp.calls('append-message')).toHaveLength(0);
  });

  it('reports no active conversation when the pair is incomplete', async () => {
    expect(await close(thread({ player2ID: undefined as any }))).toBe('No active conversation to close.');
  });

  it('writes a close authored by the agent seat and returns the stamped turn', async () => {
    mcp.onTool('append-message', (args) => structuredResult({
      ID: 30, SpeakerID: args.SpeakerID, MessageType: args.MessageType, Content: args.Content, Turn: 8,
    }));

    const result = await close(thread(), 'Until next time.');

    expect(result).toBe('Conversation closed on turn 8. It cannot be reopened until a later turn.');
    const args = mcp.calls('append-message')[0].args;
    expect(args.MessageType).toBe('close');
    expect(args.SpeakerID).toBe(3); // thread.agent
    expect(args.Content).toBe('Until next time.');
  });

  it('retracts an open proposal before closing (authored by the diplomat seat)', async () => {
    mcp.respondWith('read-transcript', structuredResult({ messages: [{
      ID: 9, Player1ID: 1, Player2ID: 3, Player1Role: 'the leader', Player2Role: 'diplomat',
      SpeakerID: 1, MessageType: 'deal-proposal', Content: 'Offer',
      Payload: { Deal: { version: 1, items: [], promises: [] } }, Turn: 5, CreatedAt: 0,
    }] }));
    // The retraction goes through the transactional reject action; only the close still uses
    // append-message (which refuses deal-reject outright).
    mcp.onTool('reject-agent-deal', (args) => structuredResult({
      Result: 'rejected',
      ProposalMessageID: args.ProposalMessageID,
      AlreadyRejected: false,
      Row: {
        ID: 20, Player1ID: 1, Player2ID: 3, Player1Role: 'the leader', Player2Role: 'diplomat',
        SpeakerID: args.SpeakerID, MessageType: 'deal-reject', Content: args.Content,
        Payload: { ProposalMessageID: args.ProposalMessageID }, Turn: 7, CreatedAt: 0,
      },
    }));
    mcp.onTool('append-message', (args) => structuredResult({
      ID: 21, SpeakerID: args.SpeakerID, MessageType: args.MessageType, Content: args.Content, Turn: 7,
    }));

    const result = await close(thread(), 'Done here.');

    expect(result).toBe('Conversation closed on turn 7. It cannot be reopened until a later turn.');
    // The open proposal is rejected first, then the close is written — both authored by seat 3.
    const rejects = mcp.calls('reject-agent-deal');
    expect(rejects).toHaveLength(1);
    expect(rejects[0].args.SpeakerID).toBe(3); // thread.agent retracts
    expect(rejects[0].args.ProposalMessageID).toBe(9);
    expect(mcp.calls('append-message').map((c) => c.args.MessageType)).toEqual(['close']);
  });

  it('returns a failure string when the store write throws', async () => {
    mcp.failWith('append-message', 'store down');

    const result = await close(thread());

    expect(result).toBe('Failed to close the conversation: store down');
  });
});
