import { execFile } from 'child_process';
import { access, constants } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

/** Well-known install locations checked when `which` fails. */
const FALLBACK_PATHS = [
  join(homedir(), '.codelayers', 'bin', 'codelayers'),
  join(homedir(), '.cargo', 'bin', 'codelayers'),
  '/opt/homebrew/bin/codelayers',   // macOS Apple Silicon (brew)
  '/usr/local/bin/codelayers',      // macOS Intel / Linux (brew)
];

/**
 * Find the codelayers CLI binary asynchronously.
 * Avoids blocking the extension host (no execSync).
 *
 * @param explicitPath - Optional explicit path from settings
 * @returns Resolved CLI path, or undefined if not found
 */
export async function findCliPath(explicitPath?: string): Promise<string | undefined> {
  // Prefer explicit setting
  if (explicitPath) {
    try {
      await access(explicitPath, constants.X_OK);
      return explicitPath;
    } catch {
      // Explicit path not executable — fall through to auto-detect
    }
  }

  // Auto-detect via `which` (macOS/Linux only — Windows is blocked at activation)
  const whichResult = await new Promise<string | undefined>((resolve) => {
    execFile('which', ['codelayers'], { encoding: 'utf-8' }, (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve(undefined);
      } else {
        resolve(stdout.trim());
      }
    });
  });

  if (whichResult) return whichResult;

  // Fallback: check well-known install locations
  for (const p of FALLBACK_PATHS) {
    try {
      await access(p, constants.X_OK);
      return p;
    } catch {
      // Not found at this path — try next
    }
  }

  return undefined;
}
