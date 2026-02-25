import { describe, it, expect } from 'vitest';
import type { StdinRequest, WatchResponse, BlastRadiusResult } from '../cli/types';

function makeEmptyResult(): BlastRadiusResult {
  return {
    total_affected: 0,
    max_hop_depth: 0,
    sources: [],
    summary: { by_hop: {}, all_affected_files: [] },
  };
}

describe('StdinRequest serialization', () => {
  it('serializes fileChanged request as valid NDJSON', () => {
    const request: StdinRequest = {
      method: 'fileChanged',
      params: { paths: ['src/foo.rs', 'src/bar.rs'], seq: 1 },
    };

    const json = JSON.stringify(request);

    // NDJSON: no embedded newlines
    expect(json).not.toContain('\n');

    // Roundtrip
    const parsed = JSON.parse(json);
    expect(parsed.method).toBe('fileChanged');
    expect(parsed.params.paths).toEqual(['src/foo.rs', 'src/bar.rs']);
    expect(parsed.params.seq).toBe(1);
  });

  it('handles single path', () => {
    const request: StdinRequest = {
      method: 'fileChanged',
      params: { paths: ['main.rs'], seq: 42 },
    };

    const json = JSON.stringify(request);
    const parsed = JSON.parse(json);
    expect(parsed.params.paths).toHaveLength(1);
    expect(parsed.params.seq).toBe(42);
  });

  it('handles paths with special characters', () => {
    const request: StdinRequest = {
      method: 'fileChanged',
      params: { paths: ['src/my file (1).rs', 'src/日本語.rs'], seq: 3 },
    };

    const json = JSON.stringify(request);
    expect(json).not.toContain('\n');

    const parsed = JSON.parse(json);
    expect(parsed.params.paths).toEqual(['src/my file (1).rs', 'src/日本語.rs']);
  });
});

describe('WatchResponse parsing', () => {
  it('parses solicited response (seq=number, changed=true)', () => {
    const response: WatchResponse = {
      seq: 42,
      changed: true,
      result: {
        total_affected: 5,
        max_hop_depth: 2,
        sources: [{ path: 'a.rs', hop: 0, dependents: [] }],
        summary: { by_hop: { '0': 1 }, all_affected_files: [] },
      },
    };

    const json = JSON.stringify(response);
    const parsed: WatchResponse = JSON.parse(json);

    expect(parsed.seq).toBe(42);
    expect(parsed.changed).toBe(true);
    expect(parsed.result.total_affected).toBe(5);
    expect(parsed.result.sources).toHaveLength(1);
  });

  it('parses unsolicited response (seq=null)', () => {
    const json = JSON.stringify({
      seq: null,
      changed: true,
      result: makeEmptyResult(),
    });

    const parsed: WatchResponse = JSON.parse(json);

    expect(parsed.seq).toBeNull();
    expect(parsed.changed).toBe(true);
    expect(parsed.result).toBeDefined();
  });

  it('parses unchanged response (changed=false)', () => {
    const json = JSON.stringify({
      seq: 5,
      changed: false,
      result: makeEmptyResult(),
    });

    const parsed: WatchResponse = JSON.parse(json);

    expect(parsed.seq).toBe(5);
    expect(parsed.changed).toBe(false);
    // result is always present even when unchanged
    expect(parsed.result).toBeDefined();
    expect(parsed.result.total_affected).toBe(0);
  });

  it('result field always has required structure', () => {
    const json = JSON.stringify({
      seq: 1,
      changed: true,
      result: {
        total_affected: 3,
        max_hop_depth: 1,
        sources: [
          {
            path: 'lib.rs',
            hop: 0,
            changed_symbols: ['greet'],
            dependents: [{ path: 'main.rs', hop: 1, reason: 'calls greet', dependents: [] }],
          },
        ],
        summary: { by_hop: { '0': 1, '1': 1 }, all_affected_files: ['main.rs'] },
      },
    });

    const parsed: WatchResponse = JSON.parse(json);
    const source = parsed.result.sources[0];
    expect(source.path).toBe('lib.rs');
    expect(source.changed_symbols).toEqual(['greet']);
    expect(source.dependents).toHaveLength(1);
    expect(source.dependents[0].reason).toBe('calls greet');
  });
});

describe('WatchResponse format detection', () => {
  it('distinguishes WatchResponse from legacy BlastRadiusResult', () => {
    // WatchResponse has `result` and `changed` at top level
    const watchResponse = JSON.stringify({
      seq: 1,
      changed: true,
      result: makeEmptyResult(),
    });

    // Legacy format is bare BlastRadiusResult
    const legacyResult = JSON.stringify(makeEmptyResult());

    const parsedWatch = JSON.parse(watchResponse);
    const parsedLegacy = JSON.parse(legacyResult);

    // Detection: WatchResponse has 'result' and 'changed' fields
    expect('result' in parsedWatch && 'changed' in parsedWatch).toBe(true);
    expect('result' in parsedLegacy && 'changed' in parsedLegacy).toBe(false);
  });
});

describe('Batch paths in StdinRequest', () => {
  it('handles multiple paths in single request', () => {
    const request: StdinRequest = {
      method: 'fileChanged',
      params: {
        paths: ['src/a.rs', 'src/b.rs', 'src/c.rs', 'tests/test.rs'],
        seq: 10,
      },
    };

    const json = JSON.stringify(request);
    const parsed = JSON.parse(json);
    expect(parsed.params.paths).toHaveLength(4);
  });

  it('handles empty paths array', () => {
    const request: StdinRequest = {
      method: 'fileChanged',
      params: { paths: [], seq: 1 },
    };

    const json = JSON.stringify(request);
    const parsed = JSON.parse(json);
    expect(parsed.params.paths).toHaveLength(0);
  });
});
