/**
 * @module oracle/run-control
 *
 * Bounded scheduling for Oracle phases.
 */

/** A unit of Oracle work that is admitted by the bounded scheduler. */
export type OracleTaskFactory<T> = () => Promise<T>;

/** Outcome of one bounded scheduler run. */
export interface OracleTaskRun<T> {
  /** Results of the admitted tasks, in source order. */
  results: T[];
  /** True only when the stop predicate left queued work unadmitted. */
  stopped: boolean;
}

/**
 * Runs task factories with bounded concurrency and an optional graceful-stop predicate.
 *
 * Admission is sequential, so the admitted tasks are always the prefix of the source list
 * and `stopped` distinguishes a run that withheld work from one that merely finished while
 * a stop was pending.
 */
export async function runOracleTasks<T>(
  taskFactories: readonly OracleTaskFactory<T>[],
  concurrency: number,
  shouldStop?: () => boolean
): Promise<OracleTaskRun<T>> {
  validateConcurrency(concurrency);

  const results = new Array<T>(taskFactories.length);
  let nextIndex = 0;
  let activeCount = 0;
  let settled = false;

  return new Promise<OracleTaskRun<T>>((resolve, reject) => {
    /** Starts available work, then completes once admitted work has drained. */
    const schedule = (): void => {
      if (settled) return;

      while (activeCount < concurrency && nextIndex < taskFactories.length && !shouldStop?.()) {
        const taskIndex = nextIndex++;
        const taskFactory = taskFactories[taskIndex];
        activeCount += 1;

        Promise.resolve()
          .then(taskFactory)
          .then(result => {
            results[taskIndex] = result;
          })
          .then(
            () => {
              activeCount -= 1;
              schedule();
            },
            error => {
              activeCount -= 1;
              settled = true;
              reject(error);
            }
          );
      }

      if (activeCount === 0) {
        settled = true;
        // Every admitted task has settled, so indexes below nextIndex are dense. A pending stop
        // only counts once it actually withheld queued work: a run that admitted everything is
        // complete, and its callers must treat it as such.
        resolve({ results: results.slice(0, nextIndex), stopped: nextIndex < taskFactories.length });
      }
    };

    schedule();
  });
}

/** Validates the scheduler's concurrency the same way p-limit does. */
function validateConcurrency(concurrency: number): void {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new TypeError('Expected `concurrency` to be a number from 1 and up');
  }
}
