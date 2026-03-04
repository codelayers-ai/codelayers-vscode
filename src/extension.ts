import * as vscode from 'vscode';
import * as path from 'path';
import { ChildProcess } from 'child_process';
import { CliRunner } from './cli/runner';
import { BlastRadiusTreeProvider } from './providers/blastRadiusTree';
import { DecorationManager } from './providers/decorations';
import { BlastRadiusFileDecorationProvider } from './providers/fileDecorations';
import { BlastRadiusCodeLensProvider } from './providers/codeLens';
import { StatusBarManager } from './ui/statusBar';
import type { BlastRadiusResult, BlastRadiusSource } from './cli/types';
import { extractFirstSymbol } from './lib/blastRadiusUtils';
import { FilterState, matchesFilter } from './lib/filterState';
import { computeBackoff, initialBackoffState, type BackoffState } from './lib/backoff';
import { getConfig } from './lib/config';
import { findCliPath } from './lib/findCli';

/** Recursively find a DocumentSymbol by name. */
function findSymbolByName(
  symbols: vscode.DocumentSymbol[],
  name: string
): vscode.DocumentSymbol | undefined {
  for (const sym of symbols) {
    if (sym.name === name) return sym;
    const found = findSymbolByName(sym.children, name);
    if (found) return found;
  }
  return undefined;
}

let runner: CliRunner | undefined;
let filterState: FilterState;
let treeProvider: BlastRadiusTreeProvider;
let decorationManager: DecorationManager;
let fileDecorationProvider: BlastRadiusFileDecorationProvider;
let codeLensProvider: BlastRadiusCodeLensProvider;
let codeLensRegistration: vscode.Disposable | undefined;
let statusBarManager: StatusBarManager;
let lastResult: BlastRadiusResult | undefined;
let watchProcess: ChildProcess | undefined;
let extensionContext: vscode.ExtensionContext;
let backoffState: BackoffState = initialBackoffState();
let restartTimer: ReturnType<typeof setTimeout> | undefined;
let outputChannel: vscode.OutputChannel;

const CACHE_KEY = 'codelayers.lastResult';
const CACHE_REPO_KEY = 'codelayers.lastRepoPath';
const CACHE_VERSION_KEY = 'codelayers.cacheVersion';
const CURRENT_CACHE_VERSION = 2;

function getRepoPath(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders?.[0]?.uri.fsPath;
}

function handleUpdate(result: BlastRadiusResult): void {
  const repoPath = getRepoPath();
  if (!repoPath) return;

  lastResult = result;

  // Hide welcome view once we have results
  vscode.commands.executeCommand('setContext', 'codelayers.showWelcome', false);
  const fm = filterState.mode;

  // Tree and status bar always update
  treeProvider.update(result, repoPath);
  statusBarManager.update(result, fm);

  // Editor surfaces only update when enabled
  if (statusBarManager.enabled) {
    fileDecorationProvider.update(result, repoPath, fm);
    if (codeLensRegistration) {
      codeLensProvider.update(result, repoPath, fm);
    }
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      decorationManager.updateDecorations(editor, result, repoPath, fm);
    }
  }

  // Cache result so reload doesn't need to wait for first watch output
  extensionContext.workspaceState.update(CACHE_KEY, result);
  extensionContext.workspaceState.update(CACHE_REPO_KEY, repoPath);
  extensionContext.workspaceState.update(CACHE_VERSION_KEY, CURRENT_CACHE_VERSION);
}

function startWatchMode(): void {
  if (!runner) return;

  const repoPath = getRepoPath();
  if (!repoPath) return;

  // Kill existing watch process if any
  stopWatchMode();

  const config = getConfig();
  const ts = () => new Date().toISOString();
  outputChannel.appendLine(`[${ts()}] Starting watch mode for ${repoPath} (maxHops=${config.maxHops})`);
  statusBarManager.setWatching();

  // Record start time for backoff stability detection
  backoffState = { ...backoffState, lastStartedAt: Date.now() };

  watchProcess = runner.startWatch(
    repoPath,
    (result) => {
      handleUpdate(result);
      // Clear "Analyzing..." state on update
      statusBarManager.update(result, filterState.mode);
    },
    (msg) => {
      outputChannel.appendLine(`[CLI stderr] ${msg}`);
    },
    () => {
      // onAck: CLI responded but blast radius unchanged — clear spinner
      if (lastResult) {
        statusBarManager.update(lastResult, filterState.mode);
      }
    },
    config.maxHops
  );

  watchProcess.on('error', (err) => {
    outputChannel.appendLine(`[${ts()}] Watch process error: ${err.message}`);
    watchProcess = undefined;
    statusBarManager.setError('Watch failed');
    scheduleRestart(`error: ${err.message}`);
  });

  watchProcess.on('close', (code) => {
    outputChannel.appendLine(`[${ts()}] Watch process exited with code ${code}`);
    if (watchProcess) {
      watchProcess = undefined;
      if (code !== 0) {
        statusBarManager.setError(`CLI exited (${code})`);
      }
      scheduleRestart(`exited with code ${code}`);
    }
  });
}

function scheduleRestart(reason: string): void {
  const { delayMs, nextState } = computeBackoff(backoffState, Date.now());
  backoffState = nextState;

  const ts = new Date().toISOString();
  outputChannel.appendLine(`[${ts}] Watch stopped (${reason}). Restarting in ${delayMs}ms (attempt ${backoffState.attempts})`);
  statusBarManager.setRestarting(delayMs);

  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    startWatchMode();
  }, delayMs);
}

function stopWatchMode(): void {
  // Clear pending restart
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = undefined;
  }

  if (watchProcess) {
    const proc = watchProcess;
    watchProcess = undefined;
    proc.kill();
  }
}

/** Register or unregister the CodeLens provider based on settings. */
function updateCodeLensRegistration(enabled: boolean): void {
  if (enabled && !codeLensRegistration) {
    codeLensRegistration = vscode.languages.registerCodeLensProvider(
      { scheme: 'file' }, codeLensProvider
    );
    // Refresh if we have data
    if (lastResult) {
      const repoPath = getRepoPath();
      if (repoPath) codeLensProvider.update(lastResult, repoPath, filterState.mode);
    }
  } else if (!enabled && codeLensRegistration) {
    codeLensRegistration.dispose();
    codeLensRegistration = undefined;
    codeLensProvider.clear();
  }
}

/** Apply display-side settings that don't require a CLI restart. */
function applyDisplaySettings(): void {
  const config = getConfig();
  statusBarManager.warningThreshold = config.warningThreshold;
  updateCodeLensRegistration(config.showCodeLens);
  // Re-render with current settings
  if (lastResult) handleUpdate(lastResult);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // CodeLayers CLI is macOS/Linux only — skip activation on Windows
  if (process.platform === 'win32') {
    vscode.window.showWarningMessage(
      'CodeLayers does not support Windows yet. macOS and Linux are supported.'
    );
    return;
  }

  extensionContext = context;
  outputChannel = vscode.window.createOutputChannel('CodeLayers');
  const config = getConfig();

  // Find CLI binary — prefer explicit setting over async auto-detect
  let cliPath: string | undefined = config.cliPath || undefined;
  if (!cliPath) {
    cliPath = await findCliPath();
  }

  // Show welcome view initially (hidden once first results arrive)
  vscode.commands.executeCommand('setContext', 'codelayers.showWelcome', true);

  if (!cliPath) {
    statusBarManager?.setError('CLI not found');
    vscode.window
      .showWarningMessage(
        'CodeLayers CLI not found. Install it to see your blast radius.',
        'Install Now'
      )
      .then((choice) => {
        if (choice === 'Install Now') {
          const terminal = vscode.window.createTerminal('CodeLayers Install');
          terminal.show();
          terminal.sendText('curl -fsSL https://codelayers.ai/install.sh | sh');

          // After terminal closes, re-detect CLI and start watch mode
          const closeListener = vscode.window.onDidCloseTerminal(async (closed) => {
            if (closed !== terminal) return;
            closeListener.dispose();

            const detected = await findCliPath();
            if (detected) {
              runner = new CliRunner(detected);
              runner.setStderrHandler((msg) => {
                outputChannel.appendLine(`[CLI stderr] ${msg}`);
              });
              statusBarManager.setWatching();
              backoffState = initialBackoffState();
              startWatchMode();
              vscode.window.showInformationMessage('CodeLayers CLI installed. Blast radius is now active.');
            } else {
              vscode.window.showWarningMessage(
                'CodeLayers CLI not found after install. Try restarting your editor.'
              );
            }
          });
        }
      });
  } else {
    runner = new CliRunner(cliPath);
    runner.setStderrHandler((msg) => {
      outputChannel.appendLine(`[CLI stderr] ${msg}`);
    });
  }

  // Shared filter state — initialize from settings
  filterState = new FilterState();
  filterState.setMode(config.defaultFilterMode);
  context.subscriptions.push(filterState);
  filterState.onChange(() => {
    if (lastResult) handleUpdate(lastResult);
  });

  // Output channel & tree view
  context.subscriptions.push(outputChannel);
  treeProvider = new BlastRadiusTreeProvider(filterState);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('codelayers.blastRadius', treeProvider)
  );

  // Decorations, CodeLens & status bar
  decorationManager = new DecorationManager();
  fileDecorationProvider = new BlastRadiusFileDecorationProvider();
  codeLensProvider = new BlastRadiusCodeLensProvider();
  statusBarManager = new StatusBarManager();
  statusBarManager.warningThreshold = config.warningThreshold;
  context.subscriptions.push(
    decorationManager,
    vscode.window.registerFileDecorationProvider(fileDecorationProvider),
    fileDecorationProvider,
    statusBarManager
  );

  // Register CodeLens conditionally based on settings
  updateCodeLensRegistration(config.showCodeLens);

  // React to settings changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('codelayers')) return;

      // Compute-side settings: restart the CLI process
      if (e.affectsConfiguration('codelayers.maxHops') ||
          e.affectsConfiguration('codelayers.cliPath')) {
        // cliPath change requires full re-init
        if (e.affectsConfiguration('codelayers.cliPath')) {
          // Stop existing watch before replacing runner to avoid orphaned process
          stopWatchMode();
          const newConfig = getConfig();
          const newPath = newConfig.cliPath || undefined;
          findCliPath(newPath).then((resolved) => {
            if (resolved) {
              runner = new CliRunner(resolved);
              runner.setStderrHandler((msg) => {
                outputChannel.appendLine(`[CLI stderr] ${msg}`);
              });
            }
            backoffState = initialBackoffState();
            startWatchMode();
          });
          return; // async — don't fall through
        }
        backoffState = initialBackoffState();
        startWatchMode();
      }

      // Display-side settings: instant re-render, no restart
      if (e.affectsConfiguration('codelayers.showCodeLens') ||
          e.affectsConfiguration('codelayers.warningThreshold') ||
          e.affectsConfiguration('codelayers.defaultFilterMode')) {
        const newConfig = getConfig();
        if (e.affectsConfiguration('codelayers.defaultFilterMode')) {
          filterState.setMode(newConfig.defaultFilterMode);
        }
        applyDisplaySettings();
      }
    })
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('codelayers.toggleEnabled', () => {
      const enabled = statusBarManager.toggle();
      if (!enabled) {
        // Hide editor surfaces only — tree always stays visible
        fileDecorationProvider.clear();
        codeLensProvider.clear();
        const editor = vscode.window.activeTextEditor;
        if (editor) decorationManager.clearDecorations(editor);
      } else if (lastResult) {
        // Restore editor surfaces
        handleUpdate(lastResult);
      }
    }),
    vscode.commands.registerCommand('codelayers.analyzeBlastRadius', () => {
      // Reset backoff and restart watch (replaces one-shot analyze)
      backoffState = initialBackoffState();
      startWatchMode();
    }),
    vscode.commands.registerCommand('codelayers.refresh', () => {
      // Reset backoff and restart watch
      backoffState = initialBackoffState();
      startWatchMode();
    }),
    vscode.commands.registerCommand('codelayers.openWithDiff', async (filePath: string, reason?: string) => {
      const uri = vscode.Uri.file(filePath);
      await vscode.commands.executeCommand('vscode.open', uri);
      // Show git diff if file has uncommitted changes (silently fails if clean)
      try {
        await vscode.commands.executeCommand('git.openChange', uri);
      } catch {
        // git extension not available or file is clean — just open the file
      }
      // Navigate to callsite symbol if reason contains one
      const symbol = reason ? extractFirstSymbol(reason) : undefined;
      if (symbol) {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.uri.fsPath === filePath) {
          const text = editor.document.getText();
          const idx = text.indexOf(symbol);
          if (idx >= 0) {
            const pos = editor.document.positionAt(idx);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(
              new vscode.Range(pos, pos),
              vscode.TextEditorRevealType.InCenter
            );
          }
        }
      }
    }),
    vscode.commands.registerCommand('codelayers.cycleFilter', () => {
      filterState.showPicker();
    }),
    vscode.commands.registerCommand('codelayers.toggleDecorations', () => {
      const hidden = fileDecorationProvider.toggleVisibility();
      if (hidden) {
        // Also clear in-editor decorations
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          decorationManager.clearDecorations(editor);
        }
      } else if (lastResult) {
        // Restore in-editor decorations
        const repoPath = getRepoPath();
        const editor = vscode.window.activeTextEditor;
        if (editor && repoPath) {
          decorationManager.updateDecorations(editor, lastResult, repoPath, filterState.mode);
        }
      }
      vscode.commands.executeCommand('setContext', 'codelayers.decorationsHidden', hidden);
    }),
    vscode.commands.registerCommand('codelayers.showCallers',
      async (symbolName: string, callers: BlastRadiusSource[], repoPath: string) => {
        const filtered = callers.filter(c => matchesFilter(c.reason, filterState.mode));
        const items = filtered.map(c => ({
          label: path.basename(c.path),
          description: path.dirname(c.path),
          detail: c.reason ? `\u2190 ${c.reason}` : undefined,
          filePath: path.join(repoPath, c.path),
          reason: c.reason,
        }));

        const picked = await vscode.window.showQuickPick(items, {
          title: `Files that call ${symbolName}`,
          placeHolder: 'Select a caller to navigate to',
        });

        if (picked) {
          await vscode.commands.executeCommand(
            'codelayers.openWithDiff', picked.filePath, picked.reason
          );
        }
      }
    ),
    vscode.commands.registerCommand('codelayers.traceDownstream',
      async (sourcePath: string, dependents: BlastRadiusSource[], repoPath: string) => {
        const fileName = path.basename(sourcePath);
        const filtered = dependents.filter(d => matchesFilter(d.reason, filterState.mode));
        const items = filtered.map(d => ({
          label: path.basename(d.path),
          description: path.dirname(d.path),
          detail: d.reason ? `\u2190 ${d.reason}` : undefined,
          filePath: path.join(repoPath, d.path),
          reason: d.reason,
        }));

        const picked = await vscode.window.showQuickPick(items, {
          title: `Downstream from ${fileName}`,
          placeHolder: `${filtered.length} file${filtered.length === 1 ? '' : 's'} depend on this`,
        });

        if (picked) {
          await vscode.commands.executeCommand(
            'codelayers.openWithDiff', picked.filePath, picked.reason
          );
        }
      }
    ),
    vscode.commands.registerCommand('codelayers.goToSymbol', async (filePath: string, symbolName: string) => {
      const uri = vscode.Uri.file(filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);

      // Try VS Code's symbol provider first (accurate)
      try {
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
          'vscode.executeDocumentSymbolProvider', uri
        );
        if (symbols) {
          const found = findSymbolByName(symbols, symbolName);
          if (found) {
            editor.selection = new vscode.Selection(found.range.start, found.range.start);
            editor.revealRange(found.range, vscode.TextEditorRevealType.InCenter);
            return;
          }
        }
      } catch {
        // symbol provider not available
      }

      // Fallback: text search
      const text = doc.getText();
      const idx = text.indexOf(symbolName);
      if (idx >= 0) {
        const pos = doc.positionAt(idx);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      }
    })
  );

  // Update decorations when switching editors
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && lastResult && statusBarManager.enabled && !fileDecorationProvider.isHidden) {
        const repoPath = getRepoPath();
        if (repoPath) {
          decorationManager.updateDecorations(editor, lastResult, repoPath, filterState.mode);
        }
      }
    })
  );

  // Notify CLI of file saves for targeted incremental analysis
  let saveDebounceTimer: ReturnType<typeof setTimeout> | undefined;
  const pendingSavePaths = new Set<string>();

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (!runner || !watchProcess) return;

      const repoPath = getRepoPath();
      if (!repoPath) return;

      const absPath = doc.uri.fsPath;
      if (!absPath.startsWith(repoPath)) return;

      const relPath = path.relative(repoPath, absPath);
      pendingSavePaths.add(relPath);

      // Debounce: batch saves within 150ms
      if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
      saveDebounceTimer = setTimeout(() => {
        saveDebounceTimer = undefined;
        const paths = Array.from(pendingSavePaths);
        pendingSavePaths.clear();

        if (paths.length > 0 && runner) {
          const seq = runner.sendFileChanged(paths);
          if (seq > 0) {
            statusBarManager.setAnalyzing();
          }
          // seq === -1 means stdin not writable (watch process restarting)
        }
      }, 150);
    })
  );

  // Restart watch when workspace folders change (e.g. multi-root workspace)
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      backoffState = initialBackoffState();
      startWatchMode();
    })
  );

  // Restore cached result instantly (avoids blank UI on reload)
  const cachedVersion = context.workspaceState.get<number>(CACHE_VERSION_KEY);
  const cachedResult = context.workspaceState.get<BlastRadiusResult>(CACHE_KEY);
  const cachedRepoPath = context.workspaceState.get<string>(CACHE_REPO_KEY);
  const repoPath = getRepoPath();
  if (cachedVersion === CURRENT_CACHE_VERSION && cachedResult && cachedRepoPath && cachedRepoPath === repoPath) {
    handleUpdate(cachedResult);
  } else {
    // Invalidate stale cache from older schema version
    context.workspaceState.update(CACHE_KEY, undefined);
    context.workspaceState.update(CACHE_REPO_KEY, undefined);
  }

  // Start watch mode — CLI handles file watching, debounce, and NDJSON streaming
  if (runner) {
    if (!cachedResult) {
      vscode.commands.executeCommand('setContext', 'codelayers.showWelcome', false);
      treeProvider.setLoading();
    }
    startWatchMode();
  }
}

export function deactivate(): void {
  stopWatchMode();
  if (codeLensRegistration) {
    codeLensRegistration.dispose();
    codeLensRegistration = undefined;
  }
}
