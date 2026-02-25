import { describe, it, expect } from 'vitest';
import {
  collectByHop,
  flattenSources,
  buildParentMap,
  buildAnalyzeArgs,
  buildWatchArgs,
  computeStatusBarState,
  parseCliOutput,
  parseNdjsonLines,
  extractFirstSymbol,
  findSymbolPositions,
} from '../lib/blastRadiusUtils';
import type { BlastRadiusSource, BlastRadiusResult } from '../cli/types';

function makeSource(path: string, hop: number, dependents: BlastRadiusSource[] = []): BlastRadiusSource {
  return { path, hop, dependents };
}

function makeResult(total: number, sources: BlastRadiusSource[] = []): BlastRadiusResult {
  return {
    total_affected: total,
    max_hop_depth: 0,
    sources,
    summary: { by_hop: {}, all_affected_files: [] },
  };
}

// ── collectByHop ────────────────────────────────────────────────────

describe('collectByHop', () => {
  it('returns empty map for empty sources', () => {
    const groups = collectByHop([]);
    expect(groups.size).toBe(0);
  });

  it('groups a single source at hop 0', () => {
    const groups = collectByHop([makeSource('a.rs', 0)]);
    expect(groups.size).toBe(1);
    expect(groups.get(0)?.length).toBe(1);
    expect(groups.get(0)?.[0].path).toBe('a.rs');
  });

  it('groups multi-hop tree correctly', () => {
    const tree = makeSource('c.rs', 0, [
      makeSource('b.rs', 1, [
        makeSource('a.rs', 2),
      ]),
    ]);
    const groups = collectByHop([tree]);
    expect(groups.get(0)?.length).toBe(1);
    expect(groups.get(1)?.length).toBe(1);
    expect(groups.get(2)?.length).toBe(1);
    expect(groups.get(0)?.[0].path).toBe('c.rs');
    expect(groups.get(1)?.[0].path).toBe('b.rs');
    expect(groups.get(2)?.[0].path).toBe('a.rs');
  });

  it('caps hop values at 4', () => {
    const source = makeSource('far.rs', 7);
    const groups = collectByHop([source]);
    expect(groups.has(7)).toBe(false);
    expect(groups.get(4)?.length).toBe(1);
    expect(groups.get(4)?.[0].path).toBe('far.rs');
  });

  it('handles circular references without infinite recursion', () => {
    const a = makeSource('a.rs', 0);
    const b = makeSource('b.rs', 1);
    // Create circular: a -> b -> a
    a.dependents = [b];
    b.dependents = [a];

    const groups = collectByHop([a]);
    // Should complete without hanging; both files collected
    expect(groups.get(0)?.some((s) => s.path === 'a.rs')).toBe(true);
    expect(groups.get(1)?.some((s) => s.path === 'b.rs')).toBe(true);
  });

  it('deduplicates files appearing in multiple branches', () => {
    // Both b and c depend on shared.rs
    const shared1 = makeSource('shared.rs', 2);
    const shared2 = makeSource('shared.rs', 2);
    const tree = [
      makeSource('b.rs', 0, [shared1]),
      makeSource('c.rs', 0, [shared2]),
    ];
    const groups = collectByHop(tree);
    const hop2 = groups.get(2) ?? [];
    // shared.rs should only appear once
    expect(hop2.filter((s) => s.path === 'shared.rs').length).toBe(1);
  });
});

// ── flattenSources ──────────────────────────────────────────────────

describe('flattenSources', () => {
  it('returns empty map for empty sources', () => {
    const lookup = flattenSources([]);
    expect(lookup.size).toBe(0);
  });

  it('flattens a single source', () => {
    const lookup = flattenSources([makeSource('a.rs', 0)]);
    expect(lookup.size).toBe(1);
    expect(lookup.get('a.rs')?.hop).toBe(0);
  });

  it('flattens nested dependents', () => {
    const tree = makeSource('c.rs', 0, [
      makeSource('b.rs', 1, [
        makeSource('a.rs', 2),
      ]),
    ]);
    const lookup = flattenSources([tree]);
    expect(lookup.size).toBe(3);
    expect(lookup.get('c.rs')?.hop).toBe(0);
    expect(lookup.get('b.rs')?.hop).toBe(1);
    expect(lookup.get('a.rs')?.hop).toBe(2);
  });

  it('handles circular references', () => {
    const a = makeSource('a.rs', 0);
    const b = makeSource('b.rs', 1);
    a.dependents = [b];
    b.dependents = [a];

    const lookup = flattenSources([a]);
    expect(lookup.size).toBe(2);
  });
});

// ── buildAnalyzeArgs ────────────────────────────────────────────────

describe('buildAnalyzeArgs', () => {
  it('builds basic args', () => {
    const args = buildAnalyzeArgs('/repo');
    expect(args).toEqual(['blast-radius', '--format', 'json', '--path', '/repo']);
  });

  it('appends file arguments', () => {
    const args = buildAnalyzeArgs('/repo', ['src/a.rs', 'src/b.rs']);
    expect(args).toEqual([
      'blast-radius', '--format', 'json', '--path', '/repo',
      'src/a.rs', 'src/b.rs',
    ]);
  });

  it('handles empty files array', () => {
    const args = buildAnalyzeArgs('/repo', []);
    expect(args).toEqual(['blast-radius', '--format', 'json', '--path', '/repo']);
  });
});

// ── buildWatchArgs ──────────────────────────────────────────────────

describe('buildWatchArgs', () => {
  it('builds correct watch args', () => {
    const args = buildWatchArgs('/repo');
    expect(args).toEqual(['blast-radius', '--watch', '--format', 'json', '--path', '/repo']);
  });
});

// ── computeStatusBarState ───────────────────────────────────────────

describe('computeStatusBarState', () => {
  it('returns clean state when no result', () => {
    const state = computeStatusBarState();
    expect(state.text).toBe('$(check) Clean');
    expect(state.isWarning).toBe(false);
  });

  it('returns clean state when total_affected is 0', () => {
    const state = computeStatusBarState(makeResult(0));
    expect(state.text).toBe('$(check) Clean');
    expect(state.isWarning).toBe(false);
  });

  it('returns affected count without warning for small blast radius', () => {
    const state = computeStatusBarState(makeResult(5));
    expect(state.text).toBe('$(pulse) 5 files affected');
    expect(state.isWarning).toBe(false);
  });

  it('returns warning for large blast radius (>= 20)', () => {
    const state = computeStatusBarState(makeResult(25));
    expect(state.text).toBe('$(pulse) 25 files affected');
    expect(state.isWarning).toBe(true);
  });

  it('returns warning at exactly 20', () => {
    const state = computeStatusBarState(makeResult(20));
    expect(state.isWarning).toBe(true);
  });

  it('does not warn at 19', () => {
    const state = computeStatusBarState(makeResult(19));
    expect(state.isWarning).toBe(false);
  });

  it('uses custom warning threshold', () => {
    // 10 files, threshold 5 → warning
    expect(computeStatusBarState(makeResult(10), undefined, 5).isWarning).toBe(true);
    // 10 files, threshold 50 → no warning
    expect(computeStatusBarState(makeResult(10), undefined, 50).isWarning).toBe(false);
  });

  it('warns at exactly the custom threshold', () => {
    expect(computeStatusBarState(makeResult(5), undefined, 5).isWarning).toBe(true);
    expect(computeStatusBarState(makeResult(4), undefined, 5).isWarning).toBe(false);
  });
});

// ── parseCliOutput ──────────────────────────────────────────────────

describe('parseCliOutput', () => {
  it('parses valid JSON', () => {
    const json = JSON.stringify({
      total_affected: 3,
      max_hop_depth: 2,
      sources: [],
      summary: { by_hop: {}, all_affected_files: [] },
    });
    const result = parseCliOutput(json);
    expect(result.total_affected).toBe(3);
    expect(result.max_hop_depth).toBe(2);
  });

  it('throws on malformed JSON', () => {
    expect(() => parseCliOutput('not json')).toThrow();
  });

  it('throws on empty string', () => {
    expect(() => parseCliOutput('')).toThrow();
  });
});

// ── parseNdjsonLines ────────────────────────────────────────────────

describe('parseNdjsonLines', () => {
  it('parses multiple JSON lines', () => {
    const line1 = JSON.stringify({ total_affected: 1, max_hop_depth: 0, sources: [], summary: { by_hop: {}, all_affected_files: [] } });
    const line2 = JSON.stringify({ total_affected: 2, max_hop_depth: 1, sources: [], summary: { by_hop: {}, all_affected_files: [] } });
    const buffer = `${line1}\n${line2}\n`;

    const { results, remainder } = parseNdjsonLines(buffer);
    expect(results.length).toBe(2);
    expect(results[0].total_affected).toBe(1);
    expect(results[1].total_affected).toBe(2);
    expect(remainder).toBe('');
  });

  it('preserves incomplete last line as remainder', () => {
    const line1 = JSON.stringify({ total_affected: 1, max_hop_depth: 0, sources: [], summary: { by_hop: {}, all_affected_files: [] } });
    const buffer = `${line1}\n{"partial`;

    const { results, remainder } = parseNdjsonLines(buffer);
    expect(results.length).toBe(1);
    expect(remainder).toBe('{"partial');
  });

  it('skips blank lines', () => {
    const line1 = JSON.stringify({ total_affected: 1, max_hop_depth: 0, sources: [], summary: { by_hop: {}, all_affected_files: [] } });
    const buffer = `\n\n${line1}\n\n`;

    const { results } = parseNdjsonLines(buffer);
    expect(results.length).toBe(1);
  });

  it('skips malformed lines', () => {
    const good = JSON.stringify({ total_affected: 1, max_hop_depth: 0, sources: [], summary: { by_hop: {}, all_affected_files: [] } });
    const buffer = `bad json\n${good}\nalso bad\n`;

    const { results } = parseNdjsonLines(buffer);
    expect(results.length).toBe(1);
    expect(results[0].total_affected).toBe(1);
  });
});

// ── extractFirstSymbol ──────────────────────────────────────────────

describe('extractFirstSymbol', () => {
  it('extracts symbol from "calls func_b"', () => {
    expect(extractFirstSymbol('calls func_b')).toBe('func_b');
  });

  it('extracts first symbol from comma-separated list', () => {
    expect(extractFirstSymbol('calls a, b, c +2 more')).toBe('a');
  });

  it('extracts symbol from "imports ClassB"', () => {
    expect(extractFirstSymbol('imports ClassB')).toBe('ClassB');
  });

  it('extracts symbol from "references MyType"', () => {
    expect(extractFirstSymbol('references MyType')).toBe('MyType');
  });

  it('returns undefined for bare "imports" with no symbol', () => {
    expect(extractFirstSymbol('imports')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(extractFirstSymbol('')).toBeUndefined();
  });

  it('returns undefined for unrecognized reason format', () => {
    expect(extractFirstSymbol('depends on something')).toBeUndefined();
  });
});

// ── buildParentMap ───────────────────────────────────────────────────

describe('buildParentMap', () => {
  it('returns empty map for empty sources', () => {
    const map = buildParentMap([]);
    expect(map.size).toBe(0);
  });

  it('maps child to parent', () => {
    const tree = makeSource('a.rs', 0, [
      makeSource('b.rs', 1),
    ]);
    const map = buildParentMap([tree]);
    expect(map.get('b.rs')).toBe('a.rs');
    expect(map.has('a.rs')).toBe(false);
  });

  it('maps multi-level chain', () => {
    const tree = makeSource('a.rs', 0, [
      makeSource('b.rs', 1, [
        makeSource('c.rs', 2),
      ]),
    ]);
    const map = buildParentMap([tree]);
    expect(map.get('b.rs')).toBe('a.rs');
    expect(map.get('c.rs')).toBe('b.rs');
  });

  it('first parent wins for shared dependents', () => {
    const shared = makeSource('shared.rs', 2);
    const tree = [
      makeSource('a.rs', 0, [{ ...shared }]),
      makeSource('b.rs', 0, [{ ...shared }]),
    ];
    const map = buildParentMap(tree);
    // First parent encountered wins
    expect(map.get('shared.rs')).toBe('a.rs');
  });
});

// ── findSymbolPositions ─────────────────────────────────────────────

describe('findSymbolPositions', () => {
  it('finds definition line for a Rust fn', () => {
    const text = '// header\npub fn parse_file(path: &Path) {\n}\n';
    const positions = findSymbolPositions(text, 'parse_file');
    expect(positions).toEqual([1]);
  });

  it('skips comment lines in usage fallback', () => {
    const text = [
      '/// This module calls parse_file for processing',
      '// parse_file is important',
      'use crate::parser;',
      'let result = parse_file(path);',
    ].join('\n');
    const positions = findSymbolPositions(text, 'parse_file');
    // Should land on line 3 (the actual usage), not line 0 or 1 (comments)
    expect(positions).toEqual([3]);
  });

  it('skips block comment lines with leading *', () => {
    const text = [
      '/*',
      ' * Uses build_graph to construct the tree',
      ' */',
      'build_graph(nodes);',
    ].join('\n');
    const positions = findSymbolPositions(text, 'build_graph');
    expect(positions).toEqual([3]);
  });

  it('skips Python comment lines', () => {
    const text = [
      '# This calls handle_request',
      'handle_request(req)',
    ].join('\n');
    const positions = findSymbolPositions(text, 'handle_request');
    expect(positions).toEqual([1]);
  });

  it('returns empty for symbol only in comments', () => {
    const text = [
      '// calls my_func',
      '# my_func is deprecated',
      '/// See my_func for details',
    ].join('\n');
    const positions = findSymbolPositions(text, 'my_func');
    expect(positions).toEqual([]);
  });
});
