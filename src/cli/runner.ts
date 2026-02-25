import { spawn, ChildProcess } from 'child_process';
import type { BlastRadiusResult, WatchResponse, StdinRequest } from './types';

export class CliRunner {
  private onStderr: ((msg: string) => void) | undefined;
  private seq = 0;
  private watchProc: ChildProcess | undefined;

  constructor(private readonly cliPath: string) {}

  /** Set a stderr listener for watch mode output */
  setStderrHandler(handler: (msg: string) => void): void {
    this.onStderr = handler;
  }

  /**
   * Send a fileChanged request to the CLI process via stdin.
   * Returns the sequence number for correlation.
   */
  sendFileChanged(paths: string[]): number {
    if (!this.watchProc?.stdin?.writable) {
      return -1;
    }

    this.seq += 1;
    const request: StdinRequest = {
      method: 'fileChanged',
      params: { paths, seq: this.seq },
    };

    this.watchProc.stdin.write(JSON.stringify(request) + '\n');
    return this.seq;
  }

  startWatch(
    repoPath: string,
    onUpdate: (result: BlastRadiusResult) => void,
    onStderr?: (message: string) => void,
    onAck?: () => void,
    maxHops?: number
  ): ChildProcess {
    const args = [
      'blast-radius', '--watch', '--format', 'json', '--path', repoPath,
    ];
    if (maxHops !== undefined) {
      args.push('--max-hops', String(maxHops));
    }
    const proc = spawn(this.cliPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.watchProc = proc;
    let buffer = '';

    proc.stdout.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);

          // Detect WatchResponse format (has `result` and `changed` fields)
          if ('result' in parsed && 'changed' in parsed) {
            const response = parsed as WatchResponse;
            if (response.changed) {
              onUpdate(response.result);
            } else if (onAck) {
              onAck();
            }
          } else {
            // Legacy format: bare BlastRadiusResult
            onUpdate(parsed as BlastRadiusResult);
          }
        } catch {
          // skip unparseable lines
        }
      }
    });

    // Drain stderr to prevent buffer deadlock
    proc.stderr.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) {
        if (onStderr) {
          onStderr(msg);
        } else if (this.onStderr) {
          this.onStderr(msg);
        }
      }
    });

    proc.on('close', () => {
      if (this.watchProc === proc) {
        this.watchProc = undefined;
      }
    });

    return proc;
  }
}
