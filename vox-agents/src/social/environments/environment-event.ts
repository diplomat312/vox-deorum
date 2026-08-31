import type { EnvironmentEvent } from './environment-adapter.js';

/** Durable event journal contract used to deduplicate environment stimuli across reconnects. */
export interface EnvironmentEventJournal { has(sourceKey: string): Promise<boolean>; record(event: EnvironmentEvent): Promise<void>; }

/** Minimal journal implementation for deterministic tests and process-local adapters. */
export class MemoryEnvironmentEventJournal implements EnvironmentEventJournal {
  private readonly keys = new Set<string>();
  /** Check whether an event provenance key was already ingested. */
  public async has(sourceKey: string): Promise<boolean> { return this.keys.has(sourceKey); }
  /** Record one event provenance key after its consumer accepts it. */
  public async record(event: EnvironmentEvent): Promise<void> { this.keys.add(event.sourceKey); }
}
