import * as vscode from 'vscode';
import * as path from 'path';
import type { BlastRadiusResult, BlastRadiusSource } from '../cli/types';
import { getHopColorId } from '../lib/colors';
import { stripSymbolAnnotation, isRemovedSymbol } from '../lib/blastRadiusUtils';
import { FilterState, FilterMode, matchesFilter } from '../lib/filterState';

// ---------------------------------------------------------------------------
// Tree item types
// ---------------------------------------------------------------------------

type BlastRadiusItem = SourceItem | SymbolItem | SummaryItem | LeafGroupItem | FooterItem;

/**
 * A file in the dependency chain. Clicking opens the file.
 * Expanding shows downstream dependents (files that depend on this one).
 */
class SourceItem extends vscode.TreeItem {
  constructor(
    public readonly source: BlastRadiusSource,
    public readonly repoPath: string,
    filterMode: FilterMode = 'all'
  ) {
    const fullPath = path.join(repoPath, source.path);
    // Count dependents that survive the current filter (what the user will actually see)
    const filteredDepCount = source.dependents.filter(
      dep => matchesFilter(dep.reason, filterMode)
    ).length;
    const hasDeps = filteredDepCount > 0;

    super(
      vscode.Uri.file(fullPath),
      hasDeps
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    // Label: filename only (directory shown via resourceUri)
    this.label = path.basename(source.path);

    // Description: show the key info inline
    const parts: string[] = [];
    // Show directory path for context
    const dir = path.dirname(source.path);
    if (dir !== '.') parts.push(dir);
    // Show changed symbols for source files (hop 0)
    if (source.changed_symbols && source.changed_symbols.length > 0 && source.hop === 0) {
      const syms = source.changed_symbols.slice(0, 3).join(', ');
      const more = source.changed_symbols.length > 3 ? ` +${source.changed_symbols.length - 3}` : '';
      parts.push(`Δ ${syms}${more}`);
    }
    // Show reason why this file is affected (for dependents, not source files)
    if (source.reason && source.hop > 0) {
      parts.push(`← ${source.reason}`);
    }
    // Show dependent count (filtered — matches what will appear on expand)
    if (hasDeps) {
      parts.push(`→ ${filteredDepCount} dep${filteredDepCount === 1 ? '' : 's'}`);
    }
    this.description = parts.join(' — ');

    // Tooltip
    const tipLines = [source.path];
    if (source.hop === 0) tipLines.push('Changed file (blast radius origin)');
    else tipLines.push(`Hop ${source.hop} from changed file`);
    if (source.changed_symbols && source.changed_symbols.length > 0) {
      tipLines.push(`Changed: ${source.changed_symbols.join(', ')}`);
    }
    if (source.reason && source.hop > 0) tipLines.push(`Depends because: ${source.reason}`);
    if (source.loc !== undefined) tipLines.push(`${source.loc} lines of code`);
    if (hasDeps) tipLines.push(`${filteredDepCount} downstream dependent${filteredDepCount === 1 ? '' : 's'}`);
    if (source.has_uncommitted_changes) tipLines.push('Has uncommitted changes');
    this.tooltip = tipLines.join('\n');

    // Icons: git-diff-like colors
    // hop 0 = changed file (red, like git modified)
    // hop 1+ = affected dependents (orange → yellow → green → blue, fading severity)
    if (source.hop === 0) {
      this.iconPath = new vscode.ThemeIcon(
        'diff-modified',
        new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')
      );
    } else {
      const hopColor = new vscode.ThemeColor(getHopColorId(Math.min(source.hop, 4)));
      let iconId = 'arrow-right';
      if (source.reason) {
        if (source.reason.startsWith('calls')) iconId = 'symbol-function';
        else if (source.reason.startsWith('imports')) iconId = 'package';
        else if (source.reason.startsWith('references')) iconId = 'symbol-reference';
      }
      this.iconPath = new vscode.ThemeIcon(iconId, hopColor);
    }

    // Click opens the file (and shows diff if uncommitted)
    this.resourceUri = vscode.Uri.file(fullPath);
    this.command = {
      command: 'codelayers.openWithDiff',
      title: 'Open File',
      arguments: [fullPath, source.reason],
    };
  }
}

/**
 * A changed function/type within a source file.
 * Groups the dependent files that call/reference this specific symbol.
 * Clicking navigates to the symbol definition.
 */
class SymbolItem extends vscode.TreeItem {
  constructor(
    public readonly symbolName: string,
    public readonly filePath: string,
    public readonly dependents: BlastRadiusSource[],
    public readonly repoPath: string
  ) {
    const hasDeps = dependents.length > 0;
    super(
      symbolName,
      hasDeps
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    this.description = hasDeps
      ? `${dependents.length} caller${dependents.length === 1 ? '' : 's'}`
      : 'no callers';
    this.iconPath = new vscode.ThemeIcon(
      'symbol-function',
      new vscode.ThemeColor('gitDecoration.modifiedResourceForeground')
    );
    this.tooltip = hasDeps
      ? `${symbolName} — ${dependents.length} file${dependents.length === 1 ? '' : 's'} call/reference this`
      : `${symbolName} — changed but nothing calls it directly`;

    // Click navigates to the symbol definition in the file
    this.command = {
      command: 'codelayers.goToSymbol',
      title: 'Go to Symbol',
      arguments: [filePath, symbolName],
    };
  }
}

/** Top-level summary line showing total affected files. */
class SummaryItem extends vscode.TreeItem {
  constructor(totalAffected: number, maxHop: number, sourceCount: number, filterMode: FilterMode) {
    super(
      `${totalAffected} file${totalAffected === 1 ? '' : 's'} affected`,
      vscode.TreeItemCollapsibleState.None
    );
    const hopPart = maxHop > 0 ? `up to ${maxHop} hop${maxHop > 1 ? 's' : ''} deep` : '';
    const filterSuffix = filterMode === 'functions' ? ' — functions only'
      : filterMode === 'imports' ? ' — imports only'
      : '';
    this.description = `${hopPart}${filterSuffix}`;
    this.iconPath = new vscode.ThemeIcon('pulse', new vscode.ThemeColor('codelayers.hop1'));
    this.tooltip = [
      `${sourceCount} changed file${sourceCount === 1 ? '' : 's'}`,
      `${totalAffected - sourceCount} affected dependent${totalAffected - sourceCount === 1 ? '' : 's'}`,
      `Maximum dependency chain depth: ${maxHop}`,
      `Filter: ${filterMode}`,
    ].join('\n');
  }
}

/** Collapsed group for leaf files (changed but nothing depends on them). */
class LeafGroupItem extends vscode.TreeItem {
  constructor(
    public readonly sources: BlastRadiusSource[],
    public readonly repoPath: string
  ) {
    super(
      `${sources.length} changed file${sources.length === 1 ? '' : 's'} with no dependents`,
      vscode.TreeItemCollapsibleState.Collapsed
    );
    this.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor(getHopColorId(0)));
    this.tooltip = 'Files you changed that nothing else depends on — safe changes';
  }
}

class FooterItem extends vscode.TreeItem {
  constructor() {
    super('Powered by CodeLayers', vscode.TreeItemCollapsibleState.None);
    this.description = 'Visualize in 3D on Vision Pro';
    this.iconPath = new vscode.ThemeIcon('eye');
    this.command = {
      command: 'vscode.open',
      title: 'Open CodeLayers',
      arguments: [vscode.Uri.parse('https://codelayers.ai?ref=vscode')],
    };
  }
}

// ---------------------------------------------------------------------------
// Tree data provider
// ---------------------------------------------------------------------------

export class BlastRadiusTreeProvider implements vscode.TreeDataProvider<BlastRadiusItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<BlastRadiusItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private result: BlastRadiusResult | undefined;
  private repoPath: string | undefined;
  private state: 'welcome' | 'loading' | 'ready' | 'error' = 'welcome';
  private errorMessage: string | undefined;
  private filterState: FilterState;

  constructor(filterState: FilterState) {
    this.filterState = filterState;
    filterState.onChange(() => this._onDidChangeTreeData.fire(undefined));
  }

  update(result: BlastRadiusResult, repoPath: string): void {
    this.result = result;
    this.repoPath = repoPath;
    this.state = 'ready';
    this.errorMessage = undefined;
    this._onDidChangeTreeData.fire(undefined);
  }

  setError(message?: string): void {
    this.state = 'error';
    this.errorMessage = message;
    this._onDidChangeTreeData.fire(undefined);
  }

  setLoading(): void {
    this.state = 'loading';
    this._onDidChangeTreeData.fire(undefined);
  }

  clear(): void {
    this.result = undefined;
    this.state = 'welcome';
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: BlastRadiusItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: BlastRadiusItem): BlastRadiusItem[] {
    if (!this.result) {
      if (this.state === 'welcome') {
        return [];
      }
      if (this.state === 'error') {
        const err = new vscode.TreeItem(this.errorMessage ?? 'Analysis failed');
        err.iconPath = new vscode.ThemeIcon('warning');
        return [err as BlastRadiusItem];
      }
      const loading = new vscode.TreeItem('Analyzing...');
      loading.iconPath = new vscode.ThemeIcon('loading~spin');
      loading.tooltip = 'Initial analysis may take 1\u20132 minutes for large repositories';
      return [loading as BlastRadiusItem];
    }

    // Root level
    if (!element) {
      const fm = this.filterState.mode;
      const withDeps = this.result.sources.filter(s =>
        s.dependents.some(d => matchesFilter(d.reason, fm))
      );
      const withoutDeps = this.result.sources.filter(s =>
        !s.dependents.some(d => matchesFilter(d.reason, fm))
      );

      if (withDeps.length === 0 && withoutDeps.length === 0) {
        const clean = new vscode.TreeItem('No structural changes detected');
        clean.description = 'Comment and body-only changes are filtered out';
        clean.iconPath = new vscode.ThemeIcon('check');
        return [clean as BlastRadiusItem];
      }

      const items: BlastRadiusItem[] = [];

      // Summary line
      if (this.result.total_affected > 0) {
        items.push(new SummaryItem(
          this.result.total_affected,
          this.result.max_hop_depth,
          this.result.sources.length,
          this.filterState.mode
        ));
      }

      // Sources with dependents (sorted by dependent count, largest blast radius first)
      const sorted = [...withDeps].sort((a, b) => b.dependents.length - a.dependents.length);
      for (const source of sorted) {
        items.push(new SourceItem(source, this.repoPath!, this.filterState.mode));
      }

      // Leaf changes grouped at bottom
      if (withoutDeps.length > 0) {
        items.push(new LeafGroupItem(withoutDeps, this.repoPath!));
      }

      items.push(new FooterItem());
      return items;
    }

    // Expand a source item
    if (element instanceof SourceItem) {
      const filteredDeps = element.source.dependents
        .filter(dep => matchesFilter(dep.reason, this.filterState.mode));

      // For hop-0 sources with changed_symbols: show symbol-grouped items
      if (element.source.hop === 0 && element.source.changed_symbols && element.source.changed_symbols.length > 0) {
        const fullPath = path.join(element.repoPath, element.source.path);
        const symbolGroups = new Map<string, BlastRadiusSource[]>();
        const unmatched: BlastRadiusSource[] = [];

        for (const dep of filteredDeps) {
          let matched = false;
          for (const rawSym of element.source.changed_symbols!) {
            const sym = stripSymbolAnnotation(rawSym);
            if (dep.reason && dep.reason.includes(sym)) {
              if (!symbolGroups.has(rawSym)) symbolGroups.set(rawSym, []);
              symbolGroups.get(rawSym)!.push(dep);
              matched = true;
              break;
            }
          }
          if (!matched) unmatched.push(dep);
        }

        const items: BlastRadiusItem[] = [];
        for (const rawSym of element.source.changed_symbols!) {
          if (isRemovedSymbol(rawSym)) continue;
          const cleanSym = stripSymbolAnnotation(rawSym);
          const deps = symbolGroups.get(rawSym) || [];
          items.push(new SymbolItem(cleanSym, fullPath, deps, element.repoPath));
        }
        // Unmatched deps shown directly below the symbol items
        for (const dep of unmatched) {
          items.push(new SourceItem(dep, element.repoPath, this.filterState.mode));
        }
        return items;
      }

      // For deeper hops or files without changed_symbols: show file dependents
      return filteredDeps.map(dep => new SourceItem(dep, element.repoPath, this.filterState.mode));
    }

    // Expand a symbol item → show its caller files
    if (element instanceof SymbolItem) {
      return element.dependents.map(dep => new SourceItem(dep, element.repoPath, this.filterState.mode));
    }

    // Expand leaf group
    if (element instanceof LeafGroupItem) {
      return element.sources.map(s => new SourceItem(s, element.repoPath, this.filterState.mode));
    }

    return [];
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
