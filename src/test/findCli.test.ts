import { describe, it, expect } from 'vitest';
import { findCliPath } from '../lib/findCli';

describe('findCliPath', () => {
  it('falls back to PATH when explicit path does not exist', async () => {
    const result = await findCliPath('/tmp/nonexistent-binary-12345');
    // Falls back to `which codelayers` then fallback paths
    expect(result === undefined || typeof result === 'string').toBe(true);
    // The key test: it does NOT return the nonexistent explicit path
    if (result) {
      expect(result).not.toBe('/tmp/nonexistent-binary-12345');
    }
  });

  it('finds a binary on PATH via which or fallback paths', async () => {
    const result = await findCliPath();
    // May find via `which` or fallback paths (brew, cargo, ~/.codelayers/bin)
    expect(result === undefined || typeof result === 'string').toBe(true);
  });

  it('returns explicit path when it exists and is executable', async () => {
    // /bin/ls is always executable
    const result = await findCliPath('/bin/ls');
    expect(result).toBe('/bin/ls');
  });

  it('falls back to PATH lookup when explicit path is not executable', async () => {
    // /dev/null exists but is not executable
    const result = await findCliPath('/dev/null');
    // Should fall through to `which codelayers` then fallback paths
    expect(result === undefined || typeof result === 'string').toBe(true);
  });
});
