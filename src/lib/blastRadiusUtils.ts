/**
 * Pure utility functions for blast radius logic.
 * Extracted from providers so they can be unit-tested without VS Code API.
 */

import type { BlastRadiusResult, BlastRadiusSource } from '../cli/types';

// ---------------------------------------------------------------------------
// Filter types — pure functions, no vscode dependency
// ---------------------------------------------------------------------------

export type FilterMode = 'functions' | 'imports' | 'all';

/** Returns true if the given reason string survives the current filter. */
export function matchesFilter(reason: string | undefined, mode: FilterMode): boolean {
  if (mode === 'all') return true;
  if (!reason) return false;
  if (mode === 'functions') return reason.startsWith('calls') || reason.startsWith('references');
  return reason.startsWith('imports');
}

/** Flatten a recursive BlastRadiusSource tree into groups by hop distance. */
export function collectByHop(
  sources: BlastRadiusSource[],
  groups: Map<number, BlastRadiusSource[]> = new Map(),
  visited: Set<string> = new Set()
): Map<number, BlastRadiusSource[]> {
  for (const source of sources) {
    if (visited.has(source.path)) continue;
    visited.add(source.path);
    const hop = Math.min(source.hop, 4);
    if (!groups.has(hop)) groups.set(hop, []);
    groups.get(hop)!.push(source);
    if (source.dependents.length > 0) {
      collectByHop(source.dependents, groups, visited);
    }
  }
  return groups;
}

/**
 * Flatten a recursive tree into a path -> source lookup.
 * When filterMode is provided, only recurse into dependents whose reason survives the filter.
 * Hop-0 sources are always included.
 */
export function flattenSources(
  sources: BlastRadiusSource[],
  lookup: Map<string, BlastRadiusSource> = new Map(),
  visited: Set<string> = new Set(),
  filterMode?: FilterMode
): Map<string, BlastRadiusSource> {
  for (const source of sources) {
    if (visited.has(source.path)) continue;
    visited.add(source.path);
    lookup.set(source.path, source);
    const deps = filterMode
      ? source.dependents.filter(d => matchesFilter(d.reason, filterMode))
      : source.dependents;
    if (deps.length > 0) {
      flattenSources(deps, lookup, visited, filterMode);
    }
  }
  return lookup;
}

/** Build a child-path → parent-path map from the blast radius tree. */
export function buildParentMap(
  sources: BlastRadiusSource[],
  parentMap: Map<string, string> = new Map(),
  visited: Set<string> = new Set()
): Map<string, string> {
  for (const source of sources) {
    if (visited.has(source.path)) continue;
    visited.add(source.path);
    for (const dep of source.dependents) {
      if (!parentMap.has(dep.path)) {
        parentMap.set(dep.path, source.path);
      }
    }
    if (source.dependents.length > 0) {
      buildParentMap(source.dependents, parentMap, visited);
    }
  }
  return parentMap;
}

/** Build CLI arguments for blast-radius analysis. */
export function buildAnalyzeArgs(repoPath: string, files?: string[]): string[] {
  const args = ['blast-radius', '--format', 'json', '--path', repoPath];
  if (files && files.length > 0) {
    args.push(...files);
  }
  return args;
}

/** Build CLI arguments for watch mode. */
export function buildWatchArgs(repoPath: string): string[] {
  return ['blast-radius', '--watch', '--format', 'json', '--path', repoPath];
}

/** Compute status bar display state from blast radius result. */
export function computeStatusBarState(
  result?: BlastRadiusResult,
  filterMode?: FilterMode,
  warningThreshold = 20
): {
  text: string;
  isWarning: boolean;
} {
  if (result && result.total_affected > 0) {
    // When a filter is active, count only files that survive the filter
    const count = filterMode
      ? flattenSources(result.sources, undefined, undefined, filterMode).size
      : result.total_affected;
    if (count === 0) return { text: '$(check) Clean', isWarning: false };
    const suffix = filterMode && filterMode !== 'all'
      ? ` (${filterMode})`
      : '';
    return {
      text: `$(pulse) ${count} files affected${suffix}`,
      isWarning: count >= warningThreshold,
    };
  }
  return { text: '$(check) Clean', isWarning: false };
}

/** Parse a single JSON line from CLI output into a BlastRadiusResult. */
export function parseCliOutput(stdout: string): BlastRadiusResult {
  return JSON.parse(stdout) as BlastRadiusResult;
}

/**
 * Extract the first symbol name from a blast radius reason string.
 * "calls func_b, parse_file" → "func_b"
 * "imports ClassB" → "ClassB"
 * "references MyType" → "MyType"
 * "imports" → undefined (no symbol after keyword)
 * "" → undefined
 */
export function extractFirstSymbol(reason: string): string | undefined {
  if (!reason) return undefined;
  // Pattern: "keyword symbol[, more...]" — grab the first word after the keyword
  const match = reason.match(/^(?:calls|imports|references)\s+(\S+)/);
  if (!match) return undefined;
  // Strip trailing comma if present (e.g. "func_b," from "calls func_b, other")
  return match[1].replace(/,$/, '') || undefined;
}

/**
 * Find line numbers where a symbol name appears as a definition.
 * Matches patterns like: `fn name`, `def name`, `function name`, `class name`,
 * `Name =`, `pub fn name`, etc.
 */
export function findSymbolPositions(text: string, symbolName: string): number[] {
  const lines = text.split('\n');
  const positions: number[] = [];
  const defPattern = new RegExp(
    `(?:^|\\s)(?:fn|def|function|class|struct|enum|trait|type|interface|const|let|var|pub\\s+fn|pub\\s+struct|pub\\s+enum|pub\\s+type|async\\s+fn|pub\\s+async\\s+fn|export\\s+function|export\\s+async\\s+function|export\\s+class|export\\s+const|export\\s+default\\s+function)\\s+${escapeRegex(symbolName)}\\b`
  );
  for (let i = 0; i < lines.length; i++) {
    if (defPattern.test(lines[i])) {
      positions.push(i);
    }
  }
  if (positions.length === 0) {
    const usagePattern = new RegExp(`\\b${escapeRegex(symbolName)}\\b`);
    for (let i = 0; i < lines.length; i++) {
      if (isCommentLine(lines[i])) continue;
      if (usagePattern.test(lines[i])) {
        positions.push(i);
        break;
      }
    }
  }
  return positions;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Returns true if a line is a comment (single-line //, ///, #, or block comment interior * ). */
function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('#') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('*/')
  );
}

/**
 * Extract symbol names from a reason string.
 * "calls parse_file, build_graph" → ["parse_file", "build_graph"]
 * "imports ClassB +2 more" → ["ClassB"]
 */
export function extractReasonSymbols(reason: string): string[] {
  const match = reason.match(/^(?:calls|imports|references)\s+(.+)/);
  if (!match) return [];
  const symbolPart = match[1].replace(/\s*\+\d+ more$/, '');
  return symbolPart.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Strip CLI annotation suffixes from changed_symbols.
 * "ensure_cache(new)" → "ensure_cache"
 * "parse_file(removed)" → "parse_file"
 * "handle_request" → "handle_request"
 */
export function stripSymbolAnnotation(sym: string): string {
  return sym.replace(/\((?:new|removed)\)$/, '').trim();
}

/** Returns true if the symbol was removed (won't exist in source). */
export function isRemovedSymbol(sym: string): boolean {
  return sym.endsWith('(removed)');
}

// ---------------------------------------------------------------------------
// Update diff — pure function for comparing successive blast radius results
// ---------------------------------------------------------------------------

export interface UpdateDiff {
  added: BlastRadiusSource[];
  removed: BlastRadiusSource[];
  changed: Array<{ current: BlastRadiusSource; previous: BlastRadiusSource }>;
  unchanged: number;
}

/**
 * Compute the diff between a previous and current blast radius result.
 * If prev is undefined, all sources are considered "added".
 */
export function computeUpdateDiff(
  prev: BlastRadiusResult | undefined,
  current: BlastRadiusResult,
): UpdateDiff {
  if (!prev) {
    return {
      added: current.sources,
      removed: [],
      changed: [],
      unchanged: 0,
    };
  }

  const prevPaths = new Set(prev.sources.map(s => s.path));
  const curPaths = new Set(current.sources.map(s => s.path));
  const prevByPath = new Map(prev.sources.map(s => [s.path, s]));

  const added = current.sources.filter(s => !prevPaths.has(s.path));
  const removed = prev.sources.filter(s => !curPaths.has(s.path));

  const kept = current.sources.filter(s => prevPaths.has(s.path));
  const changed: UpdateDiff['changed'] = [];
  let unchanged = 0;

  for (const s of kept) {
    const p = prevByPath.get(s.path)!;
    if (p.hop !== s.hop || p.dependents.length !== s.dependents.length) {
      changed.push({ current: s, previous: p });
    } else {
      unchanged++;
    }
  }

  return { added, removed, changed, unchanged };
}

/** Parse NDJSON watch output into individual results. */
export function parseNdjsonLines(buffer: string): { results: BlastRadiusResult[]; remainder: string } {
  const lines = buffer.split('\n');
  const remainder = lines.pop() ?? '';
  const results: BlastRadiusResult[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      results.push(JSON.parse(trimmed) as BlastRadiusResult);
    } catch {
      // skip malformed lines
    }
  }

  return { results, remainder };
}
