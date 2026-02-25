import * as vscode from 'vscode';
import type { FilterMode } from './blastRadiusUtils';

/** Typed access to codelayers.* VS Code settings. */
export function getConfig() {
  const cfg = vscode.workspace.getConfiguration('codelayers');
  return {
    maxHops: cfg.get<number>('maxHops', 3),
    showCodeLens: cfg.get<boolean>('showCodeLens', true),
    defaultFilterMode: cfg.get<FilterMode>('defaultFilterMode', 'all'),
    warningThreshold: cfg.get<number>('warningThreshold', 20),
    cliPath: cfg.get<string>('cliPath', ''),
  };
}
