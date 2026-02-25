# CodeLayers — Blast Radius

Know what breaks before you ship.

CodeLayers analyzes your codebase with [tree-sitter](https://tree-sitter.github.io/) and shows you exactly which files are affected by your current changes — functions, imports, type references — traced through the full dependency graph. Every save triggers a real-time re-analysis.

## Features

**Blast Radius sidebar** — Every affected file grouped by hop distance from your change.

**Hop-colored decorations** — Files are color-coded by distance in the file explorer and editor gutters:
- Red — changed file (hop 0)
- Orange — direct dependents (hop 1)
- Yellow — 2 hops away
- Green — 3 hops away
- Blue — 4+ hops away

**CodeLens annotations** — Inline caller counts and "trace downstream" links above affected symbols.

**Real-time watch mode** — Re-analyzes on every save with 150ms debounce. No manual triggers needed.

**Smart filtering** — Cycle between all dependencies, functions only, or imports only.

**10 languages** — Rust, TypeScript/JavaScript, Python, Java, Go, C++, C#, Ruby, PHP, Swift.

## Requirements

CodeLayers requires the `codelayers` CLI for parsing and graph analysis.

```bash
curl -fsSL https://codelayers.ai/install.sh | bash
```

The extension will prompt you to install the CLI if it's not found in your PATH.

## How it works

1. Open any Git repository in VS Code
2. The extension starts watching automatically
3. Edit and save a file — the sidebar updates with every file affected by your change
4. Click any file in the blast radius to open it with its git diff
5. Use CodeLens links to trace callers upstream or dependents downstream

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `codelayers.maxHops` | `3` | Maximum dependency chain depth (1-10) |
| `codelayers.showCodeLens` | `true` | Show inline caller counts above symbols |
| `codelayers.defaultFilterMode` | `all` | Filter: `all`, `functions`, or `imports` |
| `codelayers.warningThreshold` | `20` | Status bar warns when this many files are affected |
| `codelayers.cliPath` | auto-detect | Path to `codelayers` binary |

## Commands

All commands are available via the Command Palette (`Cmd+Shift+P`):

- **CodeLayers: Analyze Blast Radius** — Restart analysis
- **CodeLayers: Refresh** — Force refresh
- **CodeLayers: Filter Dependencies** — Cycle filter mode
- **CodeLayers: Toggle Blast Radius On/Off** — Enable/disable
- **CodeLayers: Toggle Blast Radius Decorations** — Show/hide file decorations
- **CodeLayers: Show Callers** — List files that call a symbol
- **CodeLayers: Trace Downstream** — List files that depend on a file
- **CodeLayers: Go to Symbol** — Jump to a symbol definition

## Links

- **Website:** [codelayers.ai](https://codelayers.ai/)
- **iOS App (Apple Vision Pro):** [CodeLayers on the App Store](https://apps.apple.com/app/codelayers/id6756067177)

## License

See [LICENSE](LICENSE) for details.
