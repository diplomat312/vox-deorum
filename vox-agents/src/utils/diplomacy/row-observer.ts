/**
 * @module utils/diplomacy/row-observer
 *
 * The per-thread capture of durable transcript rows a chat turn commits (interactive-diplomacy
 * stage 7.04, technical decision 1).
 *
 * Streaming deltas are temporary presentation; the transcript is authoritative. A turn therefore has
 * to tell its client which durable rows it actually created — the caller row, the archived diplomat
 * reply, and any deal/close row the diplomat's own tools wrote mid-run. Rereading the transcript
 * afterwards is both a wasted round trip and a correctness hazard (it also picks up rows the turn did
 * NOT write). So instead every write-through helper reports the exact row the store just confirmed,
 * and the turn that owns the thread lock collects them.
 *
 * Deliberately minimal:
 *  - **No `AsyncLocalStorage`.** The registry is keyed by thread id, and every relevant writer
 *    already receives the active `EnvoyThread`. That is the whole correlation key.
 *  - **No transcript cursor or follow-up query.** A row is recorded only after the backing store
 *    confirms the *current* operation created it.
 *  - **No transport argument threaded through the negotiator tools.** Reporting is a no-op when no
 *    turn observes that thread, so a blocking status write (or a bare tool call in a test) simply
 *    reports into the void.
 *
 * The per-thread chat lock (`chat-turn-commit.ts`) guarantees at most one turn per thread, so the
 * registry holds at most one observer per thread id and a nested write can never land in a sibling
 * turn's capture.
 */

import type { EnvoyThread } from "../../types/index.js";
import type { TranscriptPushMessage } from "./transcript-utils.js";

/** A close requested by the diplomat while a streamed chat turn is still executing. */
export interface StagedThreadClose {
  /** The agent seat that authored the closing line. */
  speakerID: number;
  /** The visible farewell to store in the close row. */
  content: string;
}

/**
 * A live capture of the durable rows one chat turn commits for its thread. Obtain one with
 * {@link observeThreadRows}, and always release it with {@link ThreadRowObserver.close} before the
 * turn releases its thread lock.
 */
export interface ThreadRowObserver {
  /** The thread this observer accepts rows for; rows for any other thread are ignored. */
  readonly threadId: string;
  /** Rows captured so far, deduplicated by transcript ID and in ascending ID order. */
  rows(): TranscriptPushMessage[];
  /**
   * Freeze the capture, unregister it, and return the final ordered snapshot. Idempotent: later
   * calls return the same frozen set, and any row reported after this point is dropped — so detached
   * work cannot extend a turn's terminal row set after it has been reported to the client.
   */
  close(): TranscriptPushMessage[];
}

/** The mutable half of an observer, kept off the public interface so only writers can record. */
interface RegisteredObserver extends ThreadRowObserver {
  record(row: TranscriptPushMessage): void;
  stageClose(close: StagedThreadClose): boolean;
  takeClose(): StagedThreadClose | undefined;
}

/**
 * The at-most-one-per-thread registry. Keyed by `thread.id` because that is exactly the granularity
 * the chat lock serializes on.
 */
const observers = new Map<string, RegisteredObserver>();

/**
 * Begin observing the durable rows committed for `thread`. Call this after the turn owns the thread
 * lock and its caller row is already committed, so the caller row belongs to the pre-run phase alone.
 *
 * @param thread   The thread whose writes should be captured.
 * @param options.ignoreIDs Transcript IDs this capture must never record — the turn's own caller row,
 *                 which is reported to the client in the `connected` phase. Enforcing the phase
 *                 boundary here (rather than trusting that no writer re-reports it) is what makes
 *                 "no ID appears in both phases" an invariant instead of an intention.
 */
export function observeThreadRows(
  thread: EnvoyThread,
  options: { ignoreIDs?: Iterable<number> } = {}
): ThreadRowObserver {
  const threadId = thread.id;
  const ignored = new Set(options.ignoreIDs ?? []);
  const captured = new Map<number, TranscriptPushMessage>();
  let frozen = false;
  let stagedClose: StagedThreadClose | undefined;

  /** The captured rows in ascending store-ID order — the durable append order. */
  const ordered = (): TranscriptPushMessage[] =>
    [...captured.values()].sort((left, right) => left.ID - right.ID);

  const observer: RegisteredObserver = {
    threadId,
    record(row) {
      if (frozen || ignored.has(row.ID) || captured.has(row.ID)) return;
      captured.set(row.ID, row);
    },
    stageClose(close) {
      if (frozen || stagedClose) return false;
      stagedClose = close;
      return true;
    },
    takeClose() {
      const close = stagedClose;
      stagedClose = undefined;
      return close;
    },
    rows: ordered,
    close() {
      frozen = true;
      stagedClose = undefined;
      // Only clear the slot if it is still ours: an overlapping turn (which the thread lock should
      // make impossible) must not have its registration torn down by a predecessor's cleanup.
      if (observers.get(threadId) === observer) observers.delete(threadId);
      return ordered();
    },
  };

  observers.set(threadId, observer);
  return observer;
}

/**
 * Report a durable row the current operation just created for `thread`. A no-op when no turn observes
 * that thread, when the row belongs to the observing turn's pre-run phase, or when the row was already
 * captured — so a writer may report unconditionally without knowing whether a turn is listening.
 *
 * Call this only AFTER the backing store confirms the write: an optimistic report would put a row the
 * store never accepted into the turn's terminal set.
 */
export function reportThreadRow(
  thread: EnvoyThread | undefined,
  row: TranscriptPushMessage | undefined
): void {
  if (!thread || !row) return;
  observers.get(thread.id)?.record(row);
}

/** Report several durable rows created by the current operation, in the order they were committed. */
export function reportThreadRows(
  thread: EnvoyThread | undefined,
  rows: readonly (TranscriptPushMessage | undefined)[]
): void {
  for (const row of rows) reportThreadRow(thread, row);
}

/**
 * Stage a diplomat close until the active chat turn reaches terminal reconciliation. Returns
 * undefined outside a streamed turn so callers can retain their immediate close behavior.
 */
export function stageThreadClose(thread: EnvoyThread | undefined, close: StagedThreadClose): boolean | undefined {
  if (!thread) return undefined;
  const observer = observers.get(thread.id);
  return observer?.stageClose(close);
}

/** Take the active turn's staged close so the terminal coordinator can commit it last. */
export function takeStagedThreadClose(thread: EnvoyThread): StagedThreadClose | undefined {
  return observers.get(thread.id)?.takeClose();
}
