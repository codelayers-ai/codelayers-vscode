import * as vscode from 'vscode';
import type { BlastRadiusResult } from '../cli/types';
import { computeStatusBarState } from '../lib/blastRadiusUtils';
import type { FilterMode } from '../lib/filterState';

export class StatusBarManager {
  private item: vscode.StatusBarItem;
  private _enabled = true;
  private lastText = '$(check) Clean';
  warningThreshold = 20;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'codelayers.toggleEnabled';
    this.update();
    this.item.show();
  }

  get enabled(): boolean { return this._enabled; }

  toggle(): boolean {
    this._enabled = !this._enabled;
    this.updateAppearance();
    return this._enabled;
  }

  update(result?: BlastRadiusResult, filterMode?: FilterMode): void {
    const state = computeStatusBarState(result, filterMode, this.warningThreshold);
    this.lastText = state.text;
    this.item.backgroundColor = state.isWarning
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
    this.updateAppearance();
  }

  /** Show "Watching..." state when watch mode is active and waiting for results. */
  setWatching(): void {
    this.lastText = '$(eye) Watching...';
    this.item.backgroundColor = undefined;
    this.updateAppearance();
  }

  /** Show "Restarting in Xs..." state when watch mode crashed and is about to restart. */
  setRestarting(delayMs: number): void {
    const seconds = Math.ceil(delayMs / 1000);
    this.lastText = `$(sync~spin) Restarting in ${seconds}s...`;
    this.item.backgroundColor = undefined;
    this.updateAppearance();
  }

  /** Show "Analyzing..." state when CLI is processing a file change. */
  setAnalyzing(): void {
    this.lastText = '$(sync~spin) Analyzing...';
    this.item.tooltip = 'Initial analysis may take 1\u20132 minutes for large repositories';
    this.item.backgroundColor = undefined;
    this.updateAppearance();
  }

  /** Show error state in the status bar. */
  setError(msg: string): void {
    this.lastText = `$(error) ${msg}`;
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    this.updateAppearance();
  }

  private updateAppearance(): void {
    if (this._enabled) {
      this.item.text = this.lastText;
      this.item.tooltip = 'CodeLayers Blast Radius — click to hide';
    } else {
      this.item.text = '$(eye-closed) Blast Radius off';
      this.item.tooltip = 'CodeLayers Blast Radius — click to show';
      this.item.backgroundColor = undefined;
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}
