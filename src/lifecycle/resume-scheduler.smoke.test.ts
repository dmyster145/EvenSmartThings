import { describe, it, expect, vi } from 'vitest';
import { createResumeScheduler, type ResumeSchedulerDeps } from './resume-scheduler';

/**
 * Smoke guard for the exact device-log churn that motivated this work
 * (timestamps 14:40:32 in the field report): within ~1s the WebView went
 * visible → hidden → visible and then a focus event landed. The OLD code
 * produced multiple full resumes + a client invalidation on the hide. The
 * fixed scheduler must produce exactly ONE resume and ZERO invalidations.
 */

function harness() {
  let nowMs = 0;
  let id = 1;
  const timers = new Map<number, { fn: () => void; dueAt: number }>();
  const advance = (ms: number) => {
    const target = nowMs + ms;
    for (;;) {
      let next: { id: number; dueAt: number } | null = null;
      for (const [tid, t] of timers) {
        if (t.dueAt <= target && (next == null || t.dueAt < next.dueAt)) next = { id: tid, dueAt: t.dueAt };
      }
      if (!next) break;
      nowMs = next.dueAt;
      const t = timers.get(next.id)!;
      timers.delete(next.id);
      t.fn();
    }
    nowMs = target;
  };
  const deps = (over: Partial<ResumeSchedulerDeps>): ResumeSchedulerDeps => ({
    now: () => nowMs,
    setTimer: (fn, ms) => { const i = id++; timers.set(i, { fn, dueAt: nowMs + ms }); return i; },
    clearTimer: (h) => { timers.delete(h as number); },
    isHidden: () => false,
    runResume: vi.fn(async () => {}),
    invalidateClient: vi.fn(),
    ...over,
  });
  return { advance, deps, flush: async () => { await Promise.resolve(); await Promise.resolve(); } };
}

describe('@smoke resume scheduler — field churn scenario', () => {
  it('visible→hidden→visible→focus within 1s ⇒ exactly 1 resume, 0 invalidations', async () => {
    const h = harness();
    const runResume = vi.fn(async () => {});
    const invalidateClient = vi.fn();
    let hidden = false;
    const s = createResumeScheduler(
      h.deps({ runResume, invalidateClient, isHidden: () => hidden }),
      { coalesceWindowMs: 700, invalidationGraceMs: 2000 },
    );

    // t=0  app visible (visibilitychange→visible) + the focus that follows
    s.notifyVisible();
    s.requestResume('visibilitychange');
    h.advance(150);

    // t=150 quick hide
    hidden = true;
    s.notifyHidden();
    h.advance(200);

    // t=350 visible again (flap well within the 2s grace)
    hidden = false;
    s.notifyVisible();
    s.requestResume('visibilitychange');
    h.advance(150);

    // t=500 focus event
    s.requestResume('focus');

    // Let the trailing debounce settle.
    h.advance(700);
    await h.flush();

    expect(runResume).toHaveBeenCalledTimes(1);
    expect(invalidateClient).toHaveBeenCalledTimes(0);
  });
});
