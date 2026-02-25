import * as vscode from 'vscode';
import * as path from 'path';
import type { BlastRadiusResult } from '../cli/types';
import { flattenSources } from '../lib/blastRadiusUtils';
import { getHopColorId } from '../lib/colors';
import { FilterMode, matchesFilter } from '../lib/filterState';

const HOP_BADGES: Record<number, string> = {
  0: '~!',
  1: '~1',
  2: '~2',
  3: '~3',
  4: '~4',
};

const HOP_TOOLTIPS: Record<number, string> = {
  0: 'Changed file (blast radius origin)',
  1: '1 hop from changed file',
  2: '2 hops from changed file',
  3: '3 hops from changed file',
  4: '4+ hops from changed file',
};

export class BlastRadiusFileDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  private lookup = new Map<string, number>(); // absolute path -> hop
  private hidden = false;

  update(result: BlastRadiusResult, repoPath: string, filterMode: FilterMode = 'all'): void {
    // Collect previously decorated paths so we can tell VS Code to clear them
    const previousPaths = new Set(this.lookup.keys());

    this.lookup.clear();
    const sources = flattenSources(result.sources, undefined, undefined, filterMode);
    for (const [relPath, source] of sources) {
      const absPath = path.join(repoPath, relPath);
      this.lookup.set(absPath, Math.min(source.hop, 4));
    }

    // Fire change for both old and new paths — VS Code won't re-query removed
    // files unless we explicitly tell it they changed.
    const changedUris: vscode.Uri[] = [];
    for (const p of previousPaths) changedUris.push(vscode.Uri.file(p));
    for (const p of this.lookup.keys()) {
      if (!previousPaths.has(p)) changedUris.push(vscode.Uri.file(p));
    }
    this._onDidChangeFileDecorations.fire(changedUris.length > 0 ? changedUris : undefined);
  }

  clear(): void {
    const uris = [...this.lookup.keys()].map(p => vscode.Uri.file(p));
    this.lookup.clear();
    this._onDidChangeFileDecorations.fire(uris.length > 0 ? uris : undefined);
  }

  /** Toggle visibility of file tree decorations. Returns new hidden state. */
  toggleVisibility(): boolean {
    this.hidden = !this.hidden;
    this._onDidChangeFileDecorations.fire(undefined);
    return this.hidden;
  }

  get isHidden(): boolean {
    return this.hidden;
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (this.hidden) return undefined;

    const hop = this.lookup.get(uri.fsPath);
    if (hop === undefined) return undefined;

    return {
      badge: HOP_BADGES[hop] ?? '4',
      tooltip: HOP_TOOLTIPS[hop] ?? `${hop}+ hops from changed file`,
      color: new vscode.ThemeColor(getHopColorId(hop)),
    };
  }

  dispose(): void {
    this._onDidChangeFileDecorations.dispose();
  }
}
