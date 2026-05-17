/**
 * Scene-execution → confirmation-icon classification.
 *
 * Rules (per product intent):
 *   - every device succeeded            → 'success'  (✓)
 *   - every device errored, OR the only device errored → 'failure' (✗)
 *   - some devices succeeded, some errored             → 'partial' (!)
 *
 * A per-device result is an ERROR iff its status is 'FAILED' — the same
 * convention the rest of the codebase uses (server didSmartThingsCommandSucceed
 * and client isDeviceCommandSuccess both key off 'FAILED'). The previous
 * implementation counted successes as only 'ACCEPTED'|'COMPLETED', so any other
 * success status string collapsed to 'failure' and the partial ('!') icon
 * never showed.
 *
 * When SmartThings returns no per-device results array (plain scene execute
 * acks), fall back to the coarse top-level status.
 */

import type { ConfirmationResult } from './icon-data';

export interface SceneExecResult {
  status?: string;
  results?: Array<{ status?: string } | null | undefined>;
}

function isErrorStatus(status: string | undefined): boolean {
  return status === 'FAILED';
}

export function classifySceneResult(result: SceneExecResult | null | undefined): ConfirmationResult {
  const results = result?.results;
  if (Array.isArray(results) && results.length > 0) {
    const total = results.length;
    const errorCount = results.filter((r) => isErrorStatus(r?.status)).length;
    if (errorCount === 0) return 'success';
    if (errorCount === total) return 'failure'; // all errored (incl. single-device)
    return 'partial'; // mixed: at least one success and at least one error
  }

  // No per-device breakdown — use the coarse status.
  const status = result?.status;
  if (status === 'success') return 'success';
  if (status === 'partial' || status === 'completed_with_errors') return 'partial';
  return 'failure';
}
