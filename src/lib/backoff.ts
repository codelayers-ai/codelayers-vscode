/**
 * Pure exponential backoff computation.
 * No vscode dependency — fully testable with Vitest.
 */

export interface BackoffState {
  attempts: number;
  lastStartedAt: number | undefined;
}

export interface BackoffConfig {
  baseMs: number;
  maxMs: number;
  stableThresholdMs: number;
}

const DEFAULT_CONFIG: BackoffConfig = {
  baseMs: 1000,
  maxMs: 30_000,
  stableThresholdMs: 60_000,
};

/**
 * Compute the next backoff delay and updated state.
 *
 * - Exponential: baseMs * 2^attempts, capped at maxMs
 * - Resets to baseMs if the last watch ran for > stableThresholdMs (stable connection)
 */
export function computeBackoff(
  state: BackoffState,
  now: number,
  config: BackoffConfig = DEFAULT_CONFIG,
): { delayMs: number; nextState: BackoffState } {
  // If last connection was stable (ran for > threshold), reset attempts
  let effectiveAttempts = state.attempts;
  if (
    state.lastStartedAt !== undefined &&
    now - state.lastStartedAt >= config.stableThresholdMs
  ) {
    effectiveAttempts = 0;
  }

  const delayMs = Math.min(
    config.baseMs * Math.pow(2, effectiveAttempts),
    config.maxMs,
  );

  return {
    delayMs,
    nextState: {
      attempts: effectiveAttempts + 1,
      lastStartedAt: state.lastStartedAt,
    },
  };
}

export function initialBackoffState(): BackoffState {
  return { attempts: 0, lastStartedAt: undefined };
}
