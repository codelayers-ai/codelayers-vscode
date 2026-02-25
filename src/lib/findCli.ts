import { execFile } from 'child_process';
import { access, constants } from 'fs/promises';

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
  return new Promise((resolve) => {
    execFile('which', ['codelayers'], { encoding: 'utf-8' }, (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve(undefined);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}
