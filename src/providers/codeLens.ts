import * as vscode from 'vscode';
import * as path from 'path';
import type { BlastRadiusResult, BlastRadiusSource } from '../cli/types';
import { flattenSources, buildParentMap, findSymbolPositions, extractReasonSymbols, stripSymbolAnnotation, isRemovedSymbol } from '../lib/blastRadiusUtils';
import { FilterMode, matchesFilter } from '../lib/filterState';

export class BlastRadiusCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  private result: BlastRadiusResult | undefined;
  private repoPath: string | undefined;
  private parentMap: Map<string, string> = new Map();
  private filterMode: FilterMode = 'all';

  update(result: BlastRadiusResult, repoPath: string, filterMode: FilterMode): void {
    this.result = result;
    this.repoPath = repoPath;
    this.filterMode = filterMode;
    this.parentMap = buildParentMap(result.sources);
    this._onDidChange.fire();
  }

  clear(): void {
    this.result = undefined;
    this._onDidChange.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.result || !this.repoPath) return [];

    const lookup = flattenSources(this.result.sources);
    const relPath = path.relative(this.repoPath, document.uri.fsPath)
      .split(path.sep).join('/');
    const source = lookup.get(relPath);
    if (!source) return [];

    const lenses: vscode.CodeLens[] = [];
    const text = document.getText();

    if (source.hop === 0) {
      // Changed file: show caller count on each changed symbol
      this.addHop0Lenses(source, text, lenses);
    } else if (source.reason) {
      // Dependent file: show why it's affected, on the relevant line
      this.addDependentLenses(source, text, lenses);
    }

    return lenses;
  }

  private addHop0Lenses(
    source: { changed_symbols?: string[]; dependents: Array<{ reason?: string; path: string; hop: number }> },
    text: string,
    lenses: vscode.CodeLens[]
  ): void {
    if (!source.changed_symbols?.length) return;

    for (const rawSym of source.changed_symbols) {
      if (isRemovedSymbol(rawSym)) continue;
      const sym = stripSymbolAnnotation(rawSym);
      if (!sym) continue;

      const callers = source.dependents.filter(
        d => d.reason && d.reason.includes(sym) && matchesFilter(d.reason, this.filterMode)
      );
      const positions = findSymbolPositions(text, sym);
      if (positions.length > 0) {
        const line = positions[0];
        const range = new vscode.Range(line, 0, line, 0);
        lenses.push(new vscode.CodeLens(range, {
          title: callers.length > 0
            ? `$(pulse) ${callers.length} caller${callers.length === 1 ? '' : 's'}`
            : '$(check) no callers — safe change',
          command: callers.length > 0
            ? 'codelayers.showCallers'
            : '',
          arguments: callers.length > 0
            ? [sym, callers, this.repoPath]
            : [],
        }));
      }
    }
  }

  private addDependentLenses(
    source: { reason?: string; reason_line?: number; hop: number; path: string; dependents: BlastRadiusSource[] },
    text: string,
    lenses: vscode.CodeLens[]
  ): void {
    if (!source.reason) return;

    // Use CLI-provided line number if available (1-indexed → 0-indexed), otherwise fall back to symbol search
    let placementLine = source.reason_line ? source.reason_line - 1 : 0;
    if (!source.reason_line) {
      const symbols = extractReasonSymbols(source.reason);
      for (const sym of symbols) {
        const positions = findSymbolPositions(text, sym);
        if (positions.length > 0) {
          placementLine = positions[0];
          break;
        }
      }
    }

    const range = new vscode.Range(placementLine, 0, placementLine, 0);

    // Upstream lens: navigate back to the file that caused this one to be affected
    const parentPath = this.parentMap.get(source.path);
    if (parentPath && this.repoPath) {
      const parentFile = parentPath.split('/').pop() ?? parentPath;
      lenses.push(new vscode.CodeLens(range, {
        title: `$(arrow-up) upstream: ${parentFile}`,
        command: 'codelayers.openWithDiff',
        arguments: [path.join(this.repoPath, parentPath)],
      }));
    }

    // Downstream lens: trace further into dependents (filtered)
    const filteredDeps = source.dependents.filter(d => matchesFilter(d.reason, this.filterMode));
    if (filteredDeps.length > 0) {
      lenses.push(new vscode.CodeLens(range, {
        title: `$(telescope) ${filteredDeps.length} downstream — click to trace`,
        command: 'codelayers.traceDownstream',
        arguments: [source.path, filteredDeps, this.repoPath],
      }));
    }
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
