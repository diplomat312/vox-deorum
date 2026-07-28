/**
 * @module utils/diplomacy/row-observer
 *
 * The per-thread coordination state for one active chat turn (interactive-diplomacy stage 7.04,
 * technical decision 1).
 *
 * Streaming deltas are temporary presentation; the transcript is authoritative. A turn therefore has
 * to tell its client which durable rows it actually created — the caller row, the archived diplomat
 * reply, and any deal/close row the diplomat's own tools wrote mid-run. Rereading the transcript
 * afterwards is both a wasted round trip and a correctness hazard (it also picks up rows the turn did
 * NOT write). So instead every write-through helper reports the exact row the store just confirmed,
 * and the turn that owns the thread lock collects them.
 *
 * The same registration carries the two other facts a mid-run tool knows and terminal reconciliation
 * needs: which durable row the spoken reply landed on (so the retained native trace attaches by ID
 * rather than by scanning for a plausible row) and whether the diplomat asked to close (held back
 * until reconciliation so the close row commits after every other durable write).
 *
 * `beginChatTurn` creates the registration right after it takes the thread lock and releases it in
 * `finish()`, so "an observer is registered for this thread" means exactly "a chat turn is in
 * flight for it" — which is what {@link stageThreadClose}'s false result reports.
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
 * One active chat turn's coordination state: the durable rows it commits, the row its spoken reply
 * landed on, and any close it staged. Obtained through {@link observeThreadRows}; `beginChatTurn`
 * releases it with {@link ThreadRowObserver.close} in the same step that releases the thread lock.
 */
export interface ThreadRowObserver {
  /** The thread this observer accepts rows for; rows for any other thread are ignored. */
  readonly threadId: string;
  /** Rows captured so far, deduplicated by transcript ID and in ascending ID order. */
  rows(): TranscriptPushMessage[];
  /**
   * The transcript ID of the turn's spoken reply, reported by the `send-message` tool that committed
   * it. Undefined unless the turn spoke exactly once: a whole-turn trace has one home or none, so an
   * ambiguous turn attaches nothing rather than picking a row.
   */
  soleSpokenRowID(): number | undefined;
  /** Take the staged close, so the terminal coordinator can commit it after every other write. */
  takeStagedClose(): StagedThreadClose | undefined;
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
  recordSpokenRow(row: TranscriptPushMessage): void;
  stageClose(close: StagedThreadClose): boolean;
}

/**
 * The at-most-one-per-thread registry. Keyed by `thread.id` because that is exactly the granularity
 * the chat lock serializes on.
 */
const observers = new Map<string, RegisteredObserver>();

/**
 * Register the active chat turn's coordination state for `thread`. `beginChatTurn` is the only
 * production caller: it registers after taking the lock and committing the caller row, so the caller
 * row belongs to the pre-run phase alone and the registration's lifetime matches the turn's.
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
  const spokenRowIDs: number[] = [];
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
    recordSpokenRow(row) {
      if (frozen || spokenRowIDs.includes(row.ID)) return;
      spokenRowIDs.push(row.ID);
    },
    soleSpokenRowID: () => (spokenRowIDs.length === 1 ? spokenRowIDs[0] : undefined),
    stageClose(close) {
      if (frozen) return false;
      if (stagedClose) return true;
      stagedClose = close;
      return true;
    },
    takeStagedClose() {
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
 * Report the durable row a `send-message` call just committed as this turn's spoken reply. The tool
 * is the only writer that knows which row is the spoken one, so it names it here instead of leaving
 * terminal reconciliation to rediscover it by scanning the captured rows.
 *
 * Reporting the row for capture is a separate concern that {@link reportThreadRow} already covers
 * from inside the append helper, so this only records the identity.
 */
export function reportSpokenRow(thread: EnvoyThread | undefined, row: TranscriptPushMessage): void {
  if (!thread) return;
  observers.get(thread.id)?.recordSpokenRow(row);
}

/**
 * Stage a diplomat close until the active chat turn reaches terminal reconciliation.
 *
 * Repeated requests are idempotent and preserve the first farewell. Returns false when no chat turn
 * is in flight for the thread, since only that lifecycle can guarantee close-last ordering.
 */
export function stageThreadClose(thread: EnvoyThread | undefined, close: StagedThreadClose): boolean {
  if (!thread) return false;
  const observer = observers.get(thread.id);
  return observer?.stageClose(close) ?? false;
}
