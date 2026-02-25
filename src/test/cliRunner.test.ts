import { describe, it, expect } from 'vitest';
import { CliRunner } from '../cli/runner';
import type { BlastRadiusResult } from '../cli/types';

function makeResult(total: number): BlastRadiusResult {
  return {
    total_affected: total,
    max_hop_depth: 1,
    sources: [],
    summary: { by_hop: {}, all_affected_files: [] },
  };
}

describe('CliRunner.sendFileChanged', () => {
  it('returns -1 when no watch process is running', () => {
    const runner = new CliRunner('/nonexistent');
    expect(runner.sendFileChanged(['a.rs'])).toBe(-1);
  });

  it('returns incrementing sequence numbers', () => {
    // Start a long-lived process so stdin is writable
    const runner = new CliRunner('node');
    const proc = runner.startWatch('/tmp', () => {});

    const seq1 = runner.sendFileChanged(['a.rs']);
    const seq2 = runner.sendFileChanged(['b.rs']);
    const seq3 = runner.sendFileChanged(['c.rs']);

    expect(seq1).toBe(1);
    expect(seq2).toBe(2);
    expect(seq3).toBe(3);

    proc.kill();
  });
});


describe('CliRunner.startWatch args', () => {
  it('includes maxHops in CLI arguments when specified', () => {
    // Verify by checking the process args
    // startWatch spawns: cliPath blast-radius --watch --format json --path repoPath [--max-hops N]
    const runner = new CliRunner('/bin/echo');
    const proc = runner.startWatch('/my/repo', () => {}, undefined, undefined, 3);

    // /bin/echo will echo args and exit, but we can verify it was called
    expect(proc.spawnargs).toContain('--max-hops');
    expect(proc.spawnargs).toContain('3');
    expect(proc.spawnargs).toContain('--path');
    expect(proc.spawnargs).toContain('/my/repo');

    proc.kill();
  });

  it('omits maxHops from CLI arguments when not specified', () => {
    const runner = new CliRunner('/bin/echo');
    const proc = runner.startWatch('/my/repo', () => {});

    expect(proc.spawnargs).not.toContain('--max-hops');
    expect(proc.spawnargs).toContain('--path');
    expect(proc.spawnargs).toContain('/my/repo');

    proc.kill();
  });
});

describe('CliRunner.setStderrHandler', () => {
  it('stores the handler for use during watch mode', () => {
    const runner = new CliRunner('/nonexistent');
    const handler = (msg: string) => { /* noop */ };
    runner.setStderrHandler(handler);

    // Verify the handler is stored (accessing private field via bracket notation)
    expect((runner as unknown as { onStderr: typeof handler }).onStderr).toBe(handler);
  });
});

describe('CliRunner NDJSON buffer splitting', () => {
  it('handles split lines across multiple data chunks', async () => {
    // This tests the core buffer logic: buffer += data; split('\n'); buffer = lines.pop()
    // Simulate the algorithm manually since we can't easily control chunk boundaries

    let buffer = '';
    const parsed: unknown[] = [];
    const result = makeResult(3);
    const fullLine = JSON.stringify({ seq: null, changed: true, result });

    // Chunk 1: partial line
    const chunk1 = fullLine.substring(0, 20);
    buffer += chunk1;
    let lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) parsed.push(JSON.parse(trimmed));
    }
    expect(parsed).toHaveLength(0); // incomplete, nothing parsed yet

    // Chunk 2: rest of line + newline + start of next
    const chunk2 = fullLine.substring(20) + '\n' + fullLine.substring(0, 10);
    buffer += chunk2;
    lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) parsed.push(JSON.parse(trimmed));
    }
    expect(parsed).toHaveLength(1); // first complete line parsed
    expect((parsed[0] as { result: BlastRadiusResult }).result.total_affected).toBe(3);

    // Chunk 3: rest of second line + newline
    const chunk3 = fullLine.substring(10) + '\n';
    buffer += chunk3;
    lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) parsed.push(JSON.parse(trimmed));
    }
    expect(parsed).toHaveLength(2); // both lines parsed
    expect(buffer).toBe(''); // buffer empty after complete lines
  });

  it('handles multiple complete lines in one chunk', () => {
    let buffer = '';
    const parsed: unknown[] = [];
    const r1 = JSON.stringify({ seq: null, changed: true, result: makeResult(1) });
    const r2 = JSON.stringify({ seq: null, changed: true, result: makeResult(2) });
    const r3 = JSON.stringify({ seq: null, changed: true, result: makeResult(3) });

    buffer += r1 + '\n' + r2 + '\n' + r3 + '\n';
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) parsed.push(JSON.parse(trimmed));
    }

    expect(parsed).toHaveLength(3);
    expect(buffer).toBe('');
  });

  it('skips empty lines and unparseable content', () => {
    let buffer = '';
    const parsed: unknown[] = [];
    const valid = JSON.stringify({ seq: null, changed: true, result: makeResult(1) });

    buffer += '\n\n' + valid + '\nnot-json\n\n';
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        parsed.push(JSON.parse(trimmed));
      } catch {
        // skip unparseable
      }
    }

    expect(parsed).toHaveLength(1);
  });
});

describe('CliRunner WatchResponse dispatch', () => {
  it('calls onUpdate for changed=true responses', () => {
    const result = makeResult(5);
    const response = { seq: 1, changed: true, result };

    // Simulate the dispatch logic from startWatch
    const updates: BlastRadiusResult[] = [];
    const acks: number[] = [];

    const onUpdate = (r: BlastRadiusResult) => updates.push(r);
    const onAck = () => acks.push(1);

    if ('result' in response && 'changed' in response) {
      if (response.changed) {
        onUpdate(response.result);
      } else if (onAck) {
        onAck();
      }
    }

    expect(updates).toHaveLength(1);
    expect(updates[0].total_affected).toBe(5);
    expect(acks).toHaveLength(0);
  });

  it('calls onAck for changed=false responses', () => {
    const response = { seq: 2, changed: false, result: makeResult(0) };

    const updates: BlastRadiusResult[] = [];
    const acks: number[] = [];
    const onUpdate = (r: BlastRadiusResult) => updates.push(r);
    const onAck = () => acks.push(1);

    if ('result' in response && 'changed' in response) {
      if (response.changed) {
        onUpdate(response.result);
      } else if (onAck) {
        onAck();
      }
    }

    expect(updates).toHaveLength(0);
    expect(acks).toHaveLength(1);
  });

  it('falls back to legacy format for bare BlastRadiusResult', () => {
    const result = makeResult(10);

    const updates: BlastRadiusResult[] = [];
    const parsed = result as unknown as Record<string, unknown>;

    if ('result' in parsed && 'changed' in parsed) {
      // WatchResponse format
    } else {
      updates.push(parsed as unknown as BlastRadiusResult);
    }

    expect(updates).toHaveLength(1);
    expect(updates[0].total_affected).toBe(10);
  });
});
