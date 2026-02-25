import { describe, it, expect } from 'vitest';
import { parseNdjsonLines } from '../lib/blastRadiusUtils';
import type { WatchResponse } from '../cli/types';

function makeJsonLine(totalAffected: number): string {
  return JSON.stringify({
    total_affected: totalAffected,
    max_hop_depth: 0,
    sources: [],
    summary: { by_hop: {}, all_affected_files: [] },
  });
}

function makeWatchResponseLine(totalAffected: number, seq: number | null, changed: boolean): string {
  return JSON.stringify({
    seq,
    changed,
    result: {
      total_affected: totalAffected,
      max_hop_depth: 0,
      sources: [],
      summary: { by_hop: {}, all_affected_files: [] },
    },
  } satisfies WatchResponse);
}

describe('NDJSON watch stream parsing', () => {
  it('handles rapid successive updates in single chunk', () => {
    const chunk = `${makeJsonLine(1)}\n${makeJsonLine(2)}\n${makeJsonLine(3)}\n`;
    const { results, remainder } = parseNdjsonLines(chunk);

    expect(results.length).toBe(3);
    expect(results[0].total_affected).toBe(1);
    expect(results[1].total_affected).toBe(2);
    expect(results[2].total_affected).toBe(3);
    expect(remainder).toBe('');
  });

  it('accumulates across multiple chunks (partial line)', () => {
    const full = makeJsonLine(42);
    const half1 = full.slice(0, 10);
    const half2 = full.slice(10);

    // First chunk: partial line, no results yet
    const { results: r1, remainder: rem1 } = parseNdjsonLines(half1);
    expect(r1.length).toBe(0);
    expect(rem1).toBe(half1);

    // Second chunk: complete the line
    const { results: r2, remainder: rem2 } = parseNdjsonLines(rem1 + half2 + '\n');
    expect(r2.length).toBe(1);
    expect(r2[0].total_affected).toBe(42);
    expect(rem2).toBe('');
  });

  it('tolerates stderr-like noise lines between results', () => {
    const chunk = [
      makeJsonLine(1),
      '[watch] Watching for changes...',
      'some debug output',
      makeJsonLine(2),
      '',
    ].join('\n');

    const { results } = parseNdjsonLines(chunk);
    expect(results.length).toBe(2);
    expect(results[0].total_affected).toBe(1);
    expect(results[1].total_affected).toBe(2);
  });

  it('handles empty buffer', () => {
    const { results, remainder } = parseNdjsonLines('');
    expect(results.length).toBe(0);
    expect(remainder).toBe('');
  });

  it('handles buffer with only newlines', () => {
    const { results, remainder } = parseNdjsonLines('\n\n\n');
    expect(results.length).toBe(0);
    expect(remainder).toBe('');
  });
});

describe('WatchResponse NDJSON parsing', () => {
  it('parses WatchResponse format lines', () => {
    const chunk = `${makeWatchResponseLine(3, 1, true)}\n${makeWatchResponseLine(3, 2, false)}\n`;
    const { results, remainder } = parseNdjsonLines(chunk);

    // parseNdjsonLines returns any valid JSON as BlastRadiusResult
    // The runner handles WatchResponse detection; here we just verify they parse
    expect(results.length).toBe(2);
    expect(remainder).toBe('');
  });

  it('parses mixed legacy and WatchResponse lines', () => {
    const chunk = [
      makeJsonLine(1),           // legacy
      makeWatchResponseLine(2, 1, true),  // new format
      makeJsonLine(3),           // legacy
      '',
    ].join('\n');

    const { results } = parseNdjsonLines(chunk);
    expect(results.length).toBe(3);
  });

  it('handles WatchResponse with null seq (unsolicited)', () => {
    const line = makeWatchResponseLine(5, null, true);
    const { results } = parseNdjsonLines(line + '\n');

    expect(results.length).toBe(1);
    // When parsed generically, the WatchResponse `seq` field is null
    const parsed = results[0] as unknown as Record<string, unknown>;
    expect(parsed['seq']).toBeNull();
  });
});
