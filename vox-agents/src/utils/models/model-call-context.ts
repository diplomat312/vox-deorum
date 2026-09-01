import type winston from 'winston';

/** Small execution context shared by game and game-independent model callers. */
export interface ModelCallContext {
  logger: winston.Logger;
  timeoutRefresh: (() => void) | undefined;
  /** Observe each actual provider attempt, including transport retries. */
  onProviderAttempt?: (attempt: number) => void;
  /** Observe a provider failure before the retry policy decides what to do. */
  onProviderError?: (error: unknown) => void;
}

/** Retry policy used by existing Vox callers when they do not provide an override. */
export interface ModelRetryPolicy {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
  executionTimeout?: number;
}

/** Preserve the existing long-running Vox retry behavior by default. */
export const DEFAULT_VOX_RETRY_POLICY: ModelRetryPolicy = {
  maxRetries: 100,
  initialDelayMs: 5000,
  maxDelayMs: 180000,
  backoffFactor: 1.2,
};
