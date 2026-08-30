/** A serial execution lane that keeps one AI actor's authoritative social runs coherent. */
export class ActorLane {
  private tail: Promise<void> = Promise.resolve();

  /** Queue work behind the actor's previous run and return its result. */
  public run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
