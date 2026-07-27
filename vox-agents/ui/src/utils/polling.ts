/**
 * Create a ref-counted interval poller with idempotent consumer cleanup.
 */
export function createPoller(tick: () => void, intervalMs: number) {
  let consumers = 0;
  let interval: number | null = null;

  /** Start the interval while at least one consumer owns the poller. */
  function start(): void {
    if (consumers === 0 || interval !== null) return;
    interval = window.setInterval(tick, intervalMs);
  }

  /** Stop the interval without releasing its current consumers. */
  function stop(): void {
    if (interval === null) return;
    window.clearInterval(interval);
    interval = null;
  }

  /** Acquire polling ownership and return an idempotent release function. */
  function acquire(): () => void {
    consumers++;
    start();

    let released = false;
    return () => {
      if (released) return;
      released = true;
      consumers = Math.max(0, consumers - 1);
      if (consumers === 0) stop();
    };
  }

  return { acquire, start, stop };
}
