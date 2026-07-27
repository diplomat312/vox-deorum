import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/api/client';
import {
  chatSessions,
  fetchChatData,
  refreshChatDataAfterDelete
} from '@/stores/telemetry';
import type { EnvoyThread, ListChatsResponse } from '@/utils/types';
import { deferred } from '../../helpers/async.js';

/** Build a minimal chat thread fixture. */
function createThread(id: string): EnvoyThread {
  return {
    id,
    agent: 1,
    gameID: 'game-1',
    player1ID: 0,
    player2ID: 1,
    contextType: 'live',
    contextId: 'game-1-player-1',
    messages: []
  };
}

afterEach(() => {
  chatSessions.value = [];
});

describe('chat refresh', () => {
  it('ignores a pre-delete response and fetches a new list', async () => {
    const staleResponse = deferred<ListChatsResponse>();
    const freshResponse = deferred<ListChatsResponse>();
    const deleted = createThread('deleted');
    const retained = createThread('retained');
    const request = vi.spyOn(api, 'getAgentChats')
      .mockReturnValueOnce(staleResponse.promise)
      .mockReturnValueOnce(freshResponse.promise);
    chatSessions.value = [deleted, retained];

    const earlierRead = fetchChatData();
    const refresh = refreshChatDataAfterDelete(deleted.id);

    expect(chatSessions.value).toEqual([retained]);
    expect(request).toHaveBeenCalledTimes(1);

    staleResponse.resolve({ chats: [deleted, retained] });
    await earlierRead;
    await Promise.resolve();

    expect(chatSessions.value).toEqual([retained]);
    expect(request).toHaveBeenCalledTimes(2);

    freshResponse.resolve({ chats: [retained] });
    await refresh;

    expect(chatSessions.value).toEqual([retained]);
  });
});
