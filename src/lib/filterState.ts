import * as vscode from 'vscode';
import type { FilterMode } from './blastRadiusUtils';

// Re-export pure types so consumers can import from either module
export type { FilterMode } from './blastRadiusUtils';
export { matchesFilter } from './blastRadiusUtils';

/**
 * Shared filter state that all blast-radius surfaces subscribe to.
 * When the mode changes, every provider re-renders with the same filtered view.
 */
export class FilterState {
  private _mode: FilterMode = 'all';
  private _onChange = new vscode.EventEmitter<FilterMode>();
  readonly onChange = this._onChange.event;

  get mode(): FilterMode { return this._mode; }

  setMode(mode: FilterMode): void {
    if (this._mode === mode) return;
    this._mode = mode;
    this._onChange.fire(mode);
  }

  async showPicker(): Promise<void> {
    const items: Array<vscode.QuickPickItem & { mode: FilterMode }> = [
      { label: '$(list-flat) All dependencies', description: 'imports, calls, references', mode: 'all', picked: this._mode === 'all' },
      { label: '$(symbol-function) Functions only', description: 'calls, references', mode: 'functions', picked: this._mode === 'functions' },
      { label: '$(package) Imports only', description: 'import statements', mode: 'imports', picked: this._mode === 'imports' },
    ];
    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `Filter dependents (current: ${this._mode})`,
    });
    if (selected) {
      this.setMode(selected.mode);
    }
  }

  dispose(): void {
    this._onChange.dispose();
  }
}
