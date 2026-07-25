/**
 * @module tests/mock/diplomacy/row-observer
 *
 * Unit coverage for the per-thread durable-row capture (src/utils/diplomacy/row-observer.ts) — the
 * mechanism that lets a chat turn report exactly the rows it committed without rereading the
 * transcript. Pure in-memory: no MCP client, no store.
 */

import { describe, expect, it } from 'vitest';
import type { EnvoyThread } from '../../../src/types/index.js';
import type { TranscriptPushMessage } from '../../../src/utils/diplomacy/transcript-utils.js';
import {
  observeThreadRows,
  reportThreadRow,
  reportThreadRows,
} from '../../../src/utils/diplomacy/row-observer.js';

/** Minimal thread identity — the capture keys off `id` and nothing else. */
function thread(id: string): EnvoyThread {
  return {
    id,
    agent: 3,
    gameID: 'g',
    player1ID: 1,
    player2ID: 3,
    player1Role: 'the leader',
    player2Role: 'diplomat',
    diplomacy: true,
    contextType: 'live',
    contextId: 'g-player-3',
    messages: [],
    metadata: {},
  };
}

/** A committed row projection, as every write-through helper returns one. */
const row = (ID: number, MessageType = 'text'): TranscriptPushMessage => ({
  ID, SpeakerID: 1, MessageType, Content: `row ${ID}`, Turn: 5,
});

describe('thread row observer', () => {
  it('returns captured rows in ascending transcript-ID order regardless of report order', () => {
    const t = thread('order');
    const observer = observeThreadRows(t);

    reportThreadRow(t, row(12));
    reportThreadRow(t, row(4));
    reportThreadRow(t, row(9));

    expect(observer.close().map((r) => r.ID)).toEqual([4, 9, 12]);
  });

  it('deduplicates by transcript ID, keeping the first reported projection', () => {
    const t = thread('dedup');
    const observer = observeThreadRows(t);

    reportThreadRow(t, { ...row(7), Content: 'first' });
    reportThreadRow(t, { ...row(7), Content: 'second' });

    const rows = observer.close();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.Content).toBe('first');
  });

  it('accepts rows only for its own thread', () => {
    // The per-thread chat lock makes overlapping turns impossible, but a nested writer handed the
    // wrong thread must never leak into a sibling conversation's capture.
    const mine = thread('mine');
    const other = thread('other');
    const observer = observeThreadRows(mine);

    reportThreadRow(other, row(1));
    reportThreadRow(mine, row(2));

    expect(observer.close().map((r) => r.ID)).toEqual([2]);
  });

  it('is a no-op when no turn observes the thread', () => {
    // A blocking status write (or a bare tool call in a test) reports into the void.
    expect(() => reportThreadRow(thread('unobserved'), row(1))).not.toThrow();
    expect(() => reportThreadRow(undefined, row(1))).not.toThrow();
    expect(() => reportThreadRow(thread('unobserved'), undefined)).not.toThrow();
  });

  it('never records an ignored ID, so the caller row cannot cross into the terminal phase', () => {
    const t = thread('phases');
    const observer = observeThreadRows(t, { ignoreIDs: [40] });

    reportThreadRow(t, row(40)); // the turn's caller row, re-reported by some later writer
    reportThreadRow(t, row(41));

    expect(observer.close().map((r) => r.ID)).toEqual([41]);
  });

  it('freezes on close: later reports are dropped and the snapshot is stable', () => {
    // Detached work must not be able to extend a terminal row set that was already reported.
    const t = thread('freeze');
    const observer = observeThreadRows(t);
    reportThreadRow(t, row(1));

    const first = observer.close();
    reportThreadRow(t, row(2));

    expect(first.map((r) => r.ID)).toEqual([1]);
    expect(observer.close().map((r) => r.ID)).toEqual([1]);
    expect(observer.rows().map((r) => r.ID)).toEqual([1]);
  });

  it('unregisters on close so a later turn on the same thread starts clean', () => {
    const t = thread('sequential');
    const first = observeThreadRows(t);
    reportThreadRow(t, row(1));
    first.close();

    const second = observeThreadRows(t);
    reportThreadRow(t, row(2));

    expect(second.close().map((r) => r.ID)).toEqual([2]);
  });

  it('reports a batch in one call, skipping absent entries', () => {
    const t = thread('batch');
    const observer = observeThreadRows(t);

    reportThreadRows(t, [row(3), undefined, row(1)]);

    expect(observer.close().map((r) => r.ID)).toEqual([1, 3]);
  });

  it('exposes a live snapshot before the turn reaches its terminal phase', () => {
    const t = thread('live');
    const observer = observeThreadRows(t);

    reportThreadRow(t, row(5));
    expect(observer.rows().map((r) => r.ID)).toEqual([5]);
    reportThreadRow(t, row(6));
    expect(observer.rows().map((r) => r.ID)).toEqual([5, 6]);
    expect(observer.threadId).toBe('live');

    observer.close();
  });
});
