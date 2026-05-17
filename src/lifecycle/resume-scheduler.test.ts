import { describe, it, expect, vi } from 'vitest';
import { createResumeScheduler, type ResumeSchedulerDeps } from './resume-scheduler';

// ---------------------------------------------------------------------------
// Controllable clock + timer harness (the scheduler takes injected timers, so
// we drive them deterministically rather than using global fake timers).
// ---------------------------------------------------------------------------

function makeHarness() {
  let nowMs = 1_000_000;
  let nextId = 1;
  const timers = new Map<number, { fn: () => void; dueAt: number }>();

  const now = () => nowMs;
  const setTimer = (fn: () => void, ms: number): unknown => {
    const id = nextId++;
    timers.set(id, { fn, dueAt: nowMs + ms });
    return id;
  };
  const clearTimer = (h: unknown): void => {
    timers.delete(h as number);
  };
  /** Advance the clock, firing due timers in due order. */
  const advance = (ms: number): void => {
    const target = nowMs + ms;
    // Loop so timers scheduled by fired timers also run within the window.
    for (;;) {
      let next: { id: number; dueAt: number } | null = null;
      for (const [id, t] of timers) {
        if (t.dueAt <= target && (next == null || t.dueAt < next.dueAt)) {
          next = { id, dueAt: t.dueAt };
        }
      }
      if (!next) break;
      nowMs = next.dueAt;
      const t = timers.get(next.id)!;
      timers.delete(next.id);
      t.fn();
    }
    nowMs = target;
  };
  const flush = async (): Promise<void> => {
    // Let queued microtasks (runResume promise chains) settle.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  return { now, setTimer, clearTimer, advance, flush, get nowMs() { return nowMs; } };
}

function makeDeps(over: Partial<ResumeSchedulerDeps> = {}) {
  const h = makeHarness();
  const runResume = vi.fn(async (_r: string[], _o: { lightweight: boolean }) => {});
  const invalidateClient = vi.fn();
  const isHidden = vi.fn(() => false);
  const deps: ResumeSchedulerDeps = {
    now: h.now,
    setTimer: h.setTimer,
    clearTimer: h.clearTimer,
    isHidden,
    runResume,
    invalidateClient,
    ...over,
  };
  return { h, deps, runResume, invalidateClient, isHidden };
}

describe('resume-scheduler', () => {
  it('coalesces a burst of requestResume into a single trailing runResume', async () => {
    const { h, deps, runResume } = makeDeps();
    const s = createResumeScheduler(deps, { coalesceWindowMs: 700 });

    s.requestResume('visibilitychange');
    h.advance(100);
    s.requestResume('focus');
    h.advance(100);
    s.requestResume('pageshow');
    h.advance(100);
    s.requestResume('online');
    expect(runResume).not.toHaveBeenCalled();

    h.advance(700);
    await h.flush();

    expect(runResume).toHaveBeenCalledTimes(1);
    const [reasons] = runResume.mock.calls[0]!;
    expect(new Set(reasons)).toEqual(
      new Set(['visibilitychange', 'focus', 'pageshow', 'online']),
    );
  });

  it('queues at most one trailing rerun while a resume is in flight', async () => {
    let resolveRun!: () => void;
    const runResume = vi.fn(
      () => new Promise<void>((res) => { resolveRun = res; }),
    );
    const { h, deps } = makeDeps({ runResume });
    const s = createResumeScheduler(deps, { coalesceWindowMs: 500 });

    s.requestResume('focus');
    h.advance(500); // fire #1 — now in flight
    await h.flush();
    expect(runResume).toHaveBeenCalledTimes(1);

    // Many triggers while #1 is still running.
    s.requestResume('a'); h.advance(500);
    s.requestResume('b'); h.advance(500);
    s.requestResume('c'); h.advance(500);
    await h.flush();
    expect(runResume).toHaveBeenCalledTimes(1); // still only the first

    resolveRun(); // #1 completes → exactly ONE trailing rerun
    await h.flush();
    expect(runResume).toHaveBeenCalledTimes(2);
  });

  it('does not invalidate the client on a quick hide→show flap', async () => {
    const { h, deps, invalidateClient } = makeDeps();
    const s = createResumeScheduler(deps, { invalidationGraceMs: 2000 });

    s.notifyHidden();
    h.advance(300); // back within grace
    s.notifyVisible();
    h.advance(5000); // well past the old grace deadline

    expect(invalidateClient).not.toHaveBeenCalled();
  });

  it('invalidates the client once when hidden past the grace period', async () => {
    const { h, deps, invalidateClient } = makeDeps();
    const s = createResumeScheduler(deps, { invalidationGraceMs: 2000 });

    s.notifyHidden();
    h.advance(2000);

    expect(invalidateClient).toHaveBeenCalledTimes(1);
    expect(invalidateClient).toHaveBeenCalledWith('hidden:grace-elapsed');
  });

  it('runs lightweight when a resume completed very recently', async () => {
    const { h, deps, runResume } = makeDeps();
    const s = createResumeScheduler(deps, {
      coalesceWindowMs: 200,
      lightweightSkipMs: 5000,
    });

    s.requestResume('focus');
    h.advance(200);
    await h.flush();
    expect(runResume.mock.calls[0]![1]).toEqual({ lightweight: false }); // first is always full

    s.requestResume('focus');
    h.advance(200);
    await h.flush();
    expect(runResume).toHaveBeenCalledTimes(2);
    expect(runResume.mock.calls[1]![1]).toEqual({ lightweight: true }); // < 5s later
  });

  it('forces a full resume after a long background even if recent', async () => {
    const { h, deps, runResume } = makeDeps();
    const s = createResumeScheduler(deps, {
      coalesceWindowMs: 200,
      lightweightSkipMs: 5000,
      forceFullResyncAfterMs: 30000,
    });

    s.requestResume('focus');
    h.advance(200);
    await h.flush(); // full #1

    s.notifyHidden();
    h.advance(31000); // long background (invalidation grace also elapses)
    deps.isHidden = () => false;
    s.notifyVisible();
    s.requestResume('visibilitychange');
    h.advance(200);
    await h.flush();

    expect(runResume).toHaveBeenCalledTimes(2);
    expect(runResume.mock.calls[1]![1]).toEqual({ lightweight: false });
  });

  it('aborts the fire when the document is hidden at debounce time', async () => {
    const isHidden = vi.fn(() => true);
    const { h, deps, runResume } = makeDeps({ isHidden });
    const s = createResumeScheduler(deps, { coalesceWindowMs: 300 });

    s.requestResume('focus');
    h.advance(300);
    await h.flush();

    expect(runResume).not.toHaveBeenCalled();
  });

  it('dispose() cancels pending timers and is idempotent', async () => {
    const { h, deps, runResume, invalidateClient } = makeDeps();
    const s = createResumeScheduler(deps, {
      coalesceWindowMs: 500,
      invalidationGraceMs: 1000,
    });

    s.requestResume('focus');
    s.notifyHidden();
    s.dispose();
    s.dispose(); // idempotent — must not throw
    h.advance(5000);
    await h.flush();

    expect(runResume).not.toHaveBeenCalled();
    expect(invalidateClient).not.toHaveBeenCalled();

    // Post-dispose requests are no-ops.
    s.requestResume('late');
    h.advance(5000);
    await h.flush();
    expect(runResume).not.toHaveBeenCalled();
  });
});
