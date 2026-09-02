import { AsyncLocalStorage } from 'node:async_hooks';

/** A serial execution lane that keeps one AI actor's authoritative social runs coherent. */
export class ActorLane {
  private tail: Promise<void> = Promise.resolve();
  private readonly active = new AsyncLocalStorage<ActorLane>();

  /** Queue work behind the actor's previous run and return its result. */
  public run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active.getStore() === this) return work();
    const result = this.tail.then(() => this.active.run(this, work));
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
