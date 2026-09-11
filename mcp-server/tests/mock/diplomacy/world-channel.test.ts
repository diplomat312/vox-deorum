/**
 * Tests for the world-channel tools (broadcast-message / get-global-messages),
 * exercised against an in-memory KnowledgeStore.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import createBroadcastMessageTool from '../../../src/tools/actions/broadcast-message.js';
import createGetGlobalMessagesTool from '../../../src/tools/knowledge/get-global-messages.js';
import { setupDiplomacyStore, seedPlayer } from '../helpers.js';
import type { KnowledgeStore } from '../../../src/knowledge/store.js';

const broadcast = createBroadcastMessageTool();
const read = createGetGlobalMessagesTool();
let store: KnowledgeStore;

beforeEach(async () => {
  store = await setupDiplomacyStore(10);
  await seedPlayer(store, 0);
  await seedPlayer(store, 1);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await store.close();
});

describe('broadcast-message', () => {
  it('stores a visible-to-all row and returns the canonical fields', async () => {
    const row = await broadcast.execute({ PlayerID: 1, Content: 'hello world', Turn: 10 } as any);
    expect(row).toMatchObject({ ID: expect.any(Number), SpeakerID: 1, Turn: 10, Content: 'hello world' });

    const messages = (await read.execute({ Limit: 50 } as any)).messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ SpeakerID: 1, Content: 'hello world', Turn: 10 });
    // Public shape only: no visibility columns leak.
    expect(messages[0]).not.toHaveProperty('Player0');
    expect(messages[0]).toHaveProperty('CreatedAt');
  });

  it('defaults Turn to the server turn and SpeakerRole to null for a major civ', async () => {
    await broadcast.execute({ PlayerID: 1, Content: 'no turn' } as any);
    const [message] = (await read.execute({ Limit: 50 } as any)).messages;
    expect(message.Turn).toBe(10);
    expect(message.SpeakerRole).toBeNull();
  });

  it('allows the observer sentinel (-1) with an observer role', async () => {
    await broadcast.execute({ PlayerID: -1, Content: 'observer speaks' } as any);
    const [message] = (await read.execute({ Limit: 50 } as any)).messages;
    expect(message.SpeakerID).toBe(-1);
    expect(message.SpeakerRole).toBe('observer');
  });

  it('rejects a non-major civilization when game info is available', async () => {
    // seat 2 is not seeded as a major; readPublicKnowledgeBatch has info for 0/1 only
    await expect(broadcast.execute({ PlayerID: 2, Content: 'nope' } as any)).rejects.toThrow(/not a major civilization/);
  });

  it('records ReplyToID and supports BeforeID paging', async () => {
    const first = await broadcast.execute({ PlayerID: 1, Content: 'first' } as any);
    await broadcast.execute({ PlayerID: 1, Content: 'reply', ReplyToID: first.ID } as any);

    const all = (await read.execute({ Limit: 50 } as any)).messages;
    expect(all).toHaveLength(2);
    // Newest first; the second references the first.
    expect(all[0].Content).toBe('reply');
    expect(all[0].ReplyToID).toBe(first.ID);

    const before = (await read.execute({ Limit: 50, BeforeID: all[0].ID } as any)).messages;
    expect(before).toHaveLength(1);
    expect(before[0].Content).toBe('first');
  });

  it('rejects empty content', async () => {
    await expect(broadcast.execute({ PlayerID: 1, Content: '' } as any)).rejects.toThrow();
  });
});

