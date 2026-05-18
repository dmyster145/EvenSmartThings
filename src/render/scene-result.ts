/**
 * Scene-execution → confirmation-icon classification.
 *
 * HARD CONSTRAINT (confirmed empirically against the live API, v1.4.20 logs):
 * the SmartThings scene-execute endpoint returns NO per-device breakdown. The
 * entire body is `{ "status": "success" | "failure" }` — there is no
 * `results[]` array and no "partial" status for scenes. SmartThings collapses
 * "1 device failed" and "all devices failed" into the same `"failure"`; it is
 * impossible to derive a true per-device partial from this endpoint.
 *
 * Given that, the most honest mapping is:
 *   - status 'success'                       → 'success' (✓ clean)
 *   - any other non-empty status (e.g.
 *     'failure'/'partial'/'completed_…')     → 'partial' (! ran, but
 *                                              SmartThings flags it didn't
 *                                              fully succeed; it will NOT tell
 *                                              us how many devices failed)
 *   - null / empty 200 body with no status   → 'failure' (✗)
 * A network/HTTP/auth failure never reaches here — the caller's catch path
 * shows ✗ for "couldn't run the scene at all".
 *
 * The per-device `results[]` branch below is retained (and unit-tested) purely
 * to future-proof: if SmartThings ever returns a per-device array for some
 * account/scene type, an ERROR row is one whose status is 'FAILED' (the same
 * convention server didSmartThingsCommandSucceed / client isDeviceCommandSuccess
 * use), and mixed FAILED/non-FAILED → 'partial'.
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
  if (!result) return 'failure';
  const results = result.results;
  if (Array.isArray(results) && results.length > 0) {
    const total = results.length;
    const errorCount = results.filter((r) => isErrorStatus(r?.status)).length;
    if (errorCount === 0) return 'success';
    if (errorCount === total) return 'failure'; // all errored (incl. single-device)
    return 'partial'; // mixed: at least one success and at least one error
  }

  // No per-device breakdown (the real, only case for SmartThings scenes).
  const status = result.status;
  if (status === 'success') return 'success';
  // SmartThings ran the scene but did not report a clean success. It gives us
  // no per-device detail, so the truthful signal is '!' (ran, verify it) —
  // never a hard ✗ here. ✗ is reserved for the caller's catch path (the scene
  // could not be executed) and a degenerate empty 200 body with no status.
  if (typeof status === 'string' && status.length > 0) return 'partial';
  return 'failure';
}
