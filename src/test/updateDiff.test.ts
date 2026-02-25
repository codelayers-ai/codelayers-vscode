import { describe, it, expect } from 'vitest';
import { computeUpdateDiff } from '../lib/blastRadiusUtils';
import type { BlastRadiusResult, BlastRadiusSource } from '../cli/types';

function makeSource(path: string, hop: number, dependents: BlastRadiusSource[] = []): BlastRadiusSource {
  return { path, hop, dependents };
}

function makeResult(sources: BlastRadiusSource[]): BlastRadiusResult {
  return {
    total_affected: sources.length,
    max_hop_depth: Math.max(0, ...sources.map(s => s.hop)),
    sources,
    summary: { by_hop: {}, all_affected_files: [] },
  };
}

describe('computeUpdateDiff', () => {
  it('all added when no previous result', () => {
    const current = makeResult([makeSource('a.rs', 0), makeSource('b.rs', 1)]);
    const diff = computeUpdateDiff(undefined, current);

    expect(diff.added.length).toBe(2);
    expect(diff.removed.length).toBe(0);
    expect(diff.changed.length).toBe(0);
    expect(diff.unchanged).toBe(0);
  });

  it('detects added files', () => {
    const prev = makeResult([makeSource('a.rs', 0)]);
    const current = makeResult([makeSource('a.rs', 0), makeSource('b.rs', 1)]);
    const diff = computeUpdateDiff(prev, current);

    expect(diff.added.length).toBe(1);
    expect(diff.added[0].path).toBe('b.rs');
    expect(diff.removed.length).toBe(0);
  });

  it('detects removed files', () => {
    const prev = makeResult([makeSource('a.rs', 0), makeSource('b.rs', 1)]);
    const current = makeResult([makeSource('a.rs', 0)]);
    const diff = computeUpdateDiff(prev, current);

    expect(diff.removed.length).toBe(1);
    expect(diff.removed[0].path).toBe('b.rs');
    expect(diff.added.length).toBe(0);
  });

  it('detects changed hop', () => {
    const prev = makeResult([makeSource('a.rs', 1)]);
    const current = makeResult([makeSource('a.rs', 2)]);
    const diff = computeUpdateDiff(prev, current);

    expect(diff.changed.length).toBe(1);
    expect(diff.changed[0].previous.hop).toBe(1);
    expect(diff.changed[0].current.hop).toBe(2);
    expect(diff.unchanged).toBe(0);
  });

  it('detects changed dependent count', () => {
    const prev = makeResult([makeSource('a.rs', 0, [makeSource('b.rs', 1)])]);
    const current = makeResult([makeSource('a.rs', 0)]);
    const diff = computeUpdateDiff(prev, current);

    expect(diff.changed.length).toBe(1);
    expect(diff.changed[0].previous.dependents.length).toBe(1);
    expect(diff.changed[0].current.dependents.length).toBe(0);
  });

  it('counts unchanged correctly', () => {
    const prev = makeResult([makeSource('a.rs', 0), makeSource('b.rs', 1)]);
    const current = makeResult([makeSource('a.rs', 0), makeSource('b.rs', 1)]);
    const diff = computeUpdateDiff(prev, current);

    expect(diff.unchanged).toBe(2);
    expect(diff.added.length).toBe(0);
    expect(diff.removed.length).toBe(0);
    expect(diff.changed.length).toBe(0);
  });

  it('empty result produces empty diff', () => {
    const prev = makeResult([]);
    const current = makeResult([]);
    const diff = computeUpdateDiff(prev, current);

    expect(diff.added.length).toBe(0);
    expect(diff.removed.length).toBe(0);
    expect(diff.changed.length).toBe(0);
    expect(diff.unchanged).toBe(0);
  });
});
