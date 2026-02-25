import { describe, it, expect } from 'vitest';
import { computeBackoff, initialBackoffState, type BackoffConfig, type BackoffState } from '../lib/backoff';

const config: BackoffConfig = {
  baseMs: 1000,
  maxMs: 30_000,
  stableThresholdMs: 60_000,
};

describe('computeBackoff', () => {
  it('starts at baseMs for first attempt', () => {
    const state = initialBackoffState();
    const { delayMs } = computeBackoff(state, Date.now(), config);
    expect(delayMs).toBe(1000);
  });

  it('doubles on each attempt', () => {
    const now = Date.now();
    let state: BackoffState = initialBackoffState();
    const delays: number[] = [];

    for (let i = 0; i < 4; i++) {
      const result = computeBackoff(state, now, config);
      delays.push(result.delayMs);
      state = result.nextState;
    }

    expect(delays).toEqual([1000, 2000, 4000, 8000]);
  });

  it('caps at maxMs', () => {
    const now = Date.now();
    let state: BackoffState = { attempts: 10, lastStartedAt: undefined };
    const { delayMs } = computeBackoff(state, now, config);
    // 1000 * 2^10 = 1_024_000, capped at 30_000
    expect(delayMs).toBe(30_000);
  });

  it('resets after stable connection period', () => {
    const startedAt = 1000;
    const now = startedAt + 61_000; // > 60s stable threshold
    const state: BackoffState = { attempts: 5, lastStartedAt: startedAt };

    const { delayMs, nextState } = computeBackoff(state, now, config);
    // Should reset to baseMs (attempts reset to 0)
    expect(delayMs).toBe(1000);
    expect(nextState.attempts).toBe(1); // 0 + 1 after reset
  });

  it('does not reset if connection was short-lived', () => {
    const startedAt = 1000;
    const now = startedAt + 5_000; // only 5s, not stable
    const state: BackoffState = { attempts: 3, lastStartedAt: startedAt };

    const { delayMs } = computeBackoff(state, now, config);
    // 1000 * 2^3 = 8000 (no reset)
    expect(delayMs).toBe(8000);
  });

  it('increments attempts in returned state', () => {
    const state = initialBackoffState();
    const { nextState } = computeBackoff(state, Date.now(), config);
    expect(nextState.attempts).toBe(1);

    const { nextState: state2 } = computeBackoff(nextState, Date.now(), config);
    expect(state2.attempts).toBe(2);
  });

  it('uses default config when none provided', () => {
    const state = initialBackoffState();
    const { delayMs } = computeBackoff(state, Date.now());
    expect(delayMs).toBe(1000);
  });
});
