/** Serial promise lane for speech decisions within one channel. */
export class ChannelLane {
  private tail: Promise<void> = Promise.resolve();

  /** Run one speech-producing operation after the prior channel operation commits. */
  public run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.tail.then(work);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
