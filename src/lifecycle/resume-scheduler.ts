/**
 * Resume scheduler — coalesces foreground/background "resume" triggers.
 *
 * The Even App WebView flips foreground↔background frequently (the user
 * glances at the phone, screen wake/sleep, app transitions). Each flip fires
 * several DOM events (visibilitychange/pageshow/focus/online). Without
 * coalescing, every flap ran a full resume (bridge re-init, session re-verify,
 * glasses rebuild) and every hide eagerly threw away the SmartThings client —
 * causing glasses flicker, a sluggish first command, and janky loads.
 *
 * This module is PURE and dependency-injected (no DOM, no SDK, no app
 * internals) so the state machine is exhaustively unit-testable with fake
 * timers. The DOM wiring lives in install-resume-lifecycle.ts; the heavy
 * resume work is injected as `runResume`.
 */

export interface ResumeSchedulerDeps {
  /** Injected Date.now (so tests control the clock). */
  now: () => number;
  /** Injected setTimeout returning an opaque handle. */
  setTimer: (fn: () => void, ms: number) => unknown;
  /** Injected clearTimeout for handles from setTimer. */
  clearTimer: (handle: unknown) => void;
  /** True when the document is currently hidden. */
  isHidden: () => boolean;
  /** Heavy resume work. `lightweight` ⇒ a full resume ran very recently; the
   *  caller should skip bridge re-init / session re-verify / glasses redraw. */
  runResume: (reasons: string[], opts: { lightweight: boolean }) => Promise<void>;
  /** Drop the cached SmartThings client (forces a token refresh next call). */
  invalidateClient: (reason: string) => void;
  /** Optional debug log sink. */
  log?: (message: string) => void;
}

export interface ResumeSchedulerConfig {
  /** Trailing-debounce window: one resume per settled burst. */
  coalesceWindowMs?: number;
  /** A hide→show flap shorter than this preserves the client (no invalidate). */
  invalidationGraceMs?: number;
  /** If a full resume completed within this window, the next is lightweight. */
  lightweightSkipMs?: number;
  /** Hidden longer than this forces a full (non-lightweight) resume. */
  forceFullResyncAfterMs?: number;
}

export interface ResumeScheduler {
  /** A visible/pageshow/focus/online trigger arrived. */
  requestResume(reason: string): void;
  /** The document became hidden. */
  notifyHidden(): void;
  /** The document became visible. */
  notifyVisible(): void;
  /** Cancel all pending timers. Idempotent. */
  dispose(): void;
}

const DEFAULTS: Required<ResumeSchedulerConfig> = {
  coalesceWindowMs: 700,
  invalidationGraceMs: 2000,
  lightweightSkipMs: 5000,
  forceFullResyncAfterMs: 30000,
};

export function createResumeScheduler(
  deps: ResumeSchedulerDeps,
  config?: ResumeSchedulerConfig,
): ResumeScheduler {
  const cfg = { ...DEFAULTS, ...(config ?? {}) };
  const log = (m: string): void => deps.log?.(m);

  let pendingReasons: string[] = [];
  let debounceHandle: unknown = null;
  let inFlight = false;
  let rerunQueued = false;
  let lastResumeCompletedAt = 0;
  let hiddenSince: number | null = null;
  /** Hidden duration captured at the most recent notifyVisible, consumed by
   *  the next fire() to decide whether to force a full resync. */
  let lastHiddenDurationMs = 0;
  let invalidationHandle: unknown = null;
  let disposed = false;

  function clear(handle: unknown): void {
    if (handle != null) deps.clearTimer(handle);
  }

  function fire(): void {
    debounceHandle = null;
    if (disposed) return;

    // Settled hidden — don't resume into a backgrounded webview.
    if (deps.isHidden()) {
      pendingReasons = [];
      log('Resume scheduler: fire aborted (hidden).');
      return;
    }

    if (inFlight) {
      // At most one trailing rerun, regardless of how many triggers landed
      // while the current resume was running.
      rerunQueued = true;
      return;
    }

    const reasons = pendingReasons.length > 0 ? [...new Set(pendingReasons)] : ['unknown'];
    pendingReasons = [];

    const recent = deps.now() - lastResumeCompletedAt < cfg.lightweightSkipMs;
    const longBackground = lastHiddenDurationMs >= cfg.forceFullResyncAfterMs;
    const lightweight = recent && !longBackground;
    lastHiddenDurationMs = 0;

    log(
      `Resume scheduler: running [${reasons.join(',')}] lightweight=${lightweight}`,
    );
    inFlight = true;
    void Promise.resolve(deps.runResume(reasons, { lightweight }))
      .catch(() => {
        // runResume already logs its own failures; never let it wedge state.
      })
      .finally(() => {
        lastResumeCompletedAt = deps.now();
        inFlight = false;
        if (rerunQueued && !disposed) {
          rerunQueued = false;
          fire();
        }
      });
  }

  function requestResume(reason: string): void {
    if (disposed) return;
    pendingReasons.push(reason);
    clear(debounceHandle);
    debounceHandle = deps.setTimer(fire, cfg.coalesceWindowMs);
  }

  function notifyHidden(): void {
    if (disposed) return;
    hiddenSince = deps.now();
    // Defer client invalidation — a quick flap shouldn't throw away the
    // client (that caused the sluggish first command after glancing).
    clear(invalidationHandle);
    invalidationHandle = deps.setTimer(() => {
      invalidationHandle = null;
      deps.invalidateClient('hidden:grace-elapsed');
    }, cfg.invalidationGraceMs);
  }

  function notifyVisible(): void {
    if (disposed) return;
    const since = hiddenSince;
    hiddenSince = null;
    const hiddenMs = since == null ? 0 : deps.now() - since;
    lastHiddenDurationMs = hiddenMs;
    if (invalidationHandle != null && hiddenMs < cfg.invalidationGraceMs) {
      // Short flap — cancel the pending invalidation, keep the client warm.
      clear(invalidationHandle);
      invalidationHandle = null;
      log(`Resume scheduler: flap (${hiddenMs}ms) — client preserved.`);
    }
  }

  function dispose(): void {
    disposed = true;
    clear(debounceHandle);
    clear(invalidationHandle);
    debounceHandle = null;
    invalidationHandle = null;
    pendingReasons = [];
    rerunQueued = false;
  }

  return { requestResume, notifyHidden, notifyVisible, dispose };
}
