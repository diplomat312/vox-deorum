import { describe, expect, it, vi } from 'vitest';
import { useTelemetrySpanPage } from '@/composables/useTelemetrySpanPage';
import type { Span } from '@/utils/types';
import { deferred } from '../../helpers/async.js';

/** Build the minimum complete span shape needed by the shared page state. */
function createSpan(spanId: string, startTime: number, parentSpanId: string | null = null): Span {
  return {
    contextId: 'session-1',
    turn: 1,
    spanId,
    traceId: 'trace-1',
    parentSpanId,
    name: spanId,
    startTime,
    endTime: startTime + 1,
    durationMs: 1,
    attributes: {},
    statusCode: 0,
    statusMessage: null
  };
}

describe('useTelemetrySpanPage', () => {
  it('should merge streamed spans by ID and keep chronological order', async () => {
    const first = createSpan('first', 2);
    const state = useTelemetrySpanPage(
      vi.fn().mockResolvedValue([first]),
      (spans) => spans[spans.length - 1] ?? null,
      'Failed to load spans'
    );
    await state.load();

    const updatedFirst = { ...first, startTime: 3 };
    const second = createSpan('second', 1);
    state.mergeSpans([updatedFirst, second]);

    expect(state.spans.value).toEqual([second, updatedFirst]);
    expect(state.rootSpan.value).toEqual(updatedFirst);
  });

  it('should expose a fallback error without discarding existing spans', async () => {
    const existing = createSpan('existing', 1);
    const state = useTelemetrySpanPage(
      vi.fn()
        .mockResolvedValueOnce([existing])
        .mockRejectedValueOnce('unavailable'),
      (spans) => spans[0] ?? null,
      'Failed to load spans'
    );
    await state.load();

    await expect(state.load()).resolves.toBe(false);
    expect(state.error.value).toBe('Failed to load spans');
    expect(state.spans.value).toEqual([existing]);
    expect(state.rootSpan.value).toEqual(existing);
  });

  it('should prefer fresh snapshot fields for known spans and retain streamed-only spans', async () => {
    const snapshot = deferred<Span[]>();
    const state = useTelemetrySpanPage(
      () => snapshot.promise,
      (spans) => spans[spans.length - 1] ?? null,
      'Failed to load spans',
      { preserveExistingOnLoad: true }
    );
    const loadPromise = state.load();
    const streamedVersion = {
      ...createSpan('shared', 1),
      durationMs: 4,
      attributes: { phase: 'streaming' },
      statusCode: 0
    };
    const streamedOnly = createSpan('streamed-only', 3);
    state.mergeSpans([streamedVersion, streamedOnly]);

    const snapshotVersion = {
      ...streamedVersion,
      durationMs: 12,
      attributes: { phase: 'complete' },
      statusCode: 1,
      statusMessage: 'Finished'
    };
    snapshot.resolve([snapshotVersion]);
    await expect(loadPromise).resolves.toBe(true);

    expect(state.spans.value).toEqual([snapshotVersion, streamedOnly]);
  });

  it('should ignore stale load completion and retain loading for the latest request', async () => {
    const first = deferred<Span[]>();
    const second = deferred<Span[]>();
    const loader = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const state = useTelemetrySpanPage(
      loader,
      (spans) => spans[spans.length - 1] ?? null,
      'Failed to load spans'
    );

    const firstLoad = state.load();
    const secondLoad = state.load();
    first.resolve([createSpan('stale', 1)]);
    await expect(firstLoad).resolves.toBe(false);
    expect(state.loading.value).toBe(true);
    expect(state.spans.value).toEqual([]);

    const latest = createSpan('latest', 2);
    second.resolve([latest]);
    await expect(secondLoad).resolves.toBe(true);
    expect(state.loading.value).toBe(false);
    expect(state.spans.value).toEqual([latest]);
  });
});
