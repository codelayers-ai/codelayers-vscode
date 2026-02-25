/**
 * TypeScript types matching the CLI `codelayers blast-radius --format json` output.
 * See cli/src/mcp/server.rs call_get_blast_radius() for the JSON structure.
 */

// ── Bidirectional protocol types (extension ↔ CLI stdin/stdout) ──

/** Sent from extension to CLI via stdin (NDJSON). */
export interface StdinRequest {
  method: 'fileChanged';
  params: { paths: string[]; seq: number };
}

/** Received from CLI via stdout (NDJSON). */
export interface WatchResponse {
  seq: number | null;
  changed: boolean;
  result: BlastRadiusResult;
}

// ── Blast radius result types ──

export interface BlastRadiusSource {
  path: string;
  hop: number;
  type?: string;
  node_type?: string;
  loc?: number;
  has_uncommitted_changes?: boolean;
  reason?: string;
  /** 1-indexed line where the call/import/reference occurs in this file (hop 1+ only) */
  reason_line?: number;
  /** Specific functions/classes that changed in this source file (hop 0 only) */
  changed_symbols?: string[];
  dependents: BlastRadiusSource[];
}

export interface BlastRadiusSummary {
  by_hop: Record<string, number>;
  all_affected_files: string[];
}

export interface BlastRadiusResult {
  total_affected: number;
  max_hop_depth: number;
  sources: BlastRadiusSource[];
  summary: BlastRadiusSummary;
}
