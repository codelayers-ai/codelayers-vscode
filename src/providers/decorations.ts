import * as vscode from 'vscode';
import * as path from 'path';
import type { BlastRadiusResult, BlastRadiusSource } from '../cli/types';
import { BLAST_RADIUS_COLORS, getBlastRadiusLabel } from '../lib/colors';
import { flattenSources as flattenSourcesUtil, findSymbolPositions, extractReasonSymbols } from '../lib/blastRadiusUtils';
import { FilterMode, matchesFilter } from '../lib/filterState';

export class DecorationManager {
  private decorationTypes: Map<number, vscode.TextEditorDecorationType> = new Map();
  private symbolDecorationType: vscode.TextEditorDecorationType;

  constructor() {
    for (let hop = 0; hop <= 4; hop++) {
      const color = BLAST_RADIUS_COLORS[hop];
      this.decorationTypes.set(hop, vscode.window.createTextEditorDecorationType({
        overviewRulerColor: color,
        overviewRulerLane: vscode.OverviewRulerLane.Left,
        isWholeLine: true,
        backgroundColor: `${color}10`,
        borderWidth: '0 0 0 3px',
        borderStyle: 'solid',
        borderColor: `${color}50`,
      }));
    }

    // Decoration for changed function/symbol definitions
    const symColor = BLAST_RADIUS_COLORS[0];
    this.symbolDecorationType = vscode.window.createTextEditorDecorationType({
      overviewRulerColor: symColor,
      overviewRulerLane: vscode.OverviewRulerLane.Left,
      isWholeLine: true,
      backgroundColor: `${symColor}12`,
      borderWidth: '0 0 0 3px',
      borderStyle: 'solid',
      borderColor: `${symColor}60`,
    });
  }

  updateDecorations(editor: vscode.TextEditor, result: BlastRadiusResult, repoPath: string, filterMode: FilterMode = 'all'): void {
    // Clear all decorations first
    for (const dt of this.decorationTypes.values()) {
      editor.setDecorations(dt, []);
    }
    editor.setDecorations(this.symbolDecorationType, []);

    // Build path -> source lookup from flattened sources
    const lookup = new Map<string, BlastRadiusSource>();
    this.flattenSources(result.sources, lookup);

    const editorRelPath = path.relative(repoPath, editor.document.uri.fsPath)
      .split(path.sep).join('/');
    const source = lookup.get(editorRelPath);
    if (!source) return;

    const hop = Math.min(source.hop, 4);
    const color = BLAST_RADIUS_COLORS[hop];
    const dt = this.decorationTypes.get(hop);
    if (!dt) return;

    const dependentCount = source.dependents.filter(d => matchesFilter(d.reason, filterMode)).length;
    const depSuffix = dependentCount > 0
      ? ` · ${dependentCount} dep${dependentCount === 1 ? '' : 's'}`
      : '';
    const hopLabel = hop === 0 ? '~! changed' : `~${hop} hop${hop > 1 ? 's' : ''}`;

    const range = new vscode.Range(0, 0, 0, 0);
    const decoration: vscode.DecorationOptions = {
      range,
      renderOptions: {
        after: {
          contentText: ` ${hopLabel}${depSuffix}`,
          color: `${color}CC`,
          fontStyle: 'italic',
          fontWeight: 'bold',
          margin: '0 0 0 1.5em',
        },
      },
    };

    editor.setDecorations(dt, [decoration]);

    // Highlight changed symbol definitions (hop 0) or call sites (hop > 0)
    const symbolDecorations: vscode.DecorationOptions[] = [];
    const text = editor.document.getText();

    if (source.hop === 0 && source.changed_symbols && source.changed_symbols.length > 0) {
      // Changed file: highlight where each changed function is defined
      for (const sym of source.changed_symbols) {
        const callerCount = source.dependents.filter(d =>
          d.reason && d.reason.includes(sym) && matchesFilter(d.reason, filterMode)
        ).length;
        const callerSuffix = callerCount > 0
          ? ` · ${callerCount} caller${callerCount === 1 ? '' : 's'}`
          : '';
        for (const pos of findSymbolPositions(text, sym)) {
          const line = editor.document.lineAt(pos);
          symbolDecorations.push({
            range: line.range,
            renderOptions: {
              after: {
                contentText: ` ~! Δ ${sym}${callerSuffix}`,
                color: `${BLAST_RADIUS_COLORS[0]}BB`,
                fontStyle: 'italic',
                margin: '0 0 0 1.5em',
              },
            },
          });
        }
      }
    } else if (source.hop > 0 && source.reason) {
      // Dependent file: highlight call sites / references to changed symbols
      const hopColor = BLAST_RADIUS_COLORS[Math.min(source.hop, 4)];
      const hopTag = `~${Math.min(source.hop, 4)}`;

      // Use CLI-provided line number if available (1-indexed → 0-indexed), otherwise search
      if (source.reason_line && source.reason_line > 0) {
        const lineIdx = Math.min(source.reason_line - 1, editor.document.lineCount - 1);
        const line = editor.document.lineAt(lineIdx);
        symbolDecorations.push({
          range: line.range,
          renderOptions: {
            after: {
              contentText: ` ${hopTag} ← ${source.reason}`,
              color: `${hopColor}BB`,
              fontStyle: 'italic',
              margin: '0 0 0 1.5em',
            },
          },
        });
      } else {
        const symbols = extractReasonSymbols(source.reason);
        for (const sym of symbols) {
          for (const pos of findSymbolPositions(text, sym)) {
            const line = editor.document.lineAt(pos);
            symbolDecorations.push({
              range: line.range,
              renderOptions: {
                after: {
                  contentText: ` ${hopTag} ← ${source.reason}`,
                  color: `${hopColor}BB`,
                  fontStyle: 'italic',
                  margin: '0 0 0 1.5em',
                },
              },
            });
          }
        }
      }
    }

    if (symbolDecorations.length > 0) {
      editor.setDecorations(this.symbolDecorationType, symbolDecorations);
    }
  }

  clearDecorations(editor: vscode.TextEditor): void {
    for (const dt of this.decorationTypes.values()) {
      editor.setDecorations(dt, []);
    }
    editor.setDecorations(this.symbolDecorationType, []);
  }

  private flattenSources(
    sources: BlastRadiusSource[],
    lookup: Map<string, BlastRadiusSource>
  ): void {
    flattenSourcesUtil(sources, lookup);
  }

  dispose(): void {
    for (const dt of this.decorationTypes.values()) {
      dt.dispose();
    }
    this.symbolDecorationType.dispose();
    this.decorationTypes.clear();
  }
}

