/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installResumeLifecycle } from './install-resume-lifecycle';
import type { ResumeScheduler } from './resume-scheduler';

/**
 * E2E: real DOM events through the actual wiring layer (jsdom). Verifies the
 * event→scheduler mapping, the hidden vs visible branch, the wake hooks, and
 * that the disposer truly removes listeners. The scheduler is a spy so we
 * assert wiring, not scheduler internals (covered by the unit tests).
 */

function makeSpyScheduler(): ResumeScheduler & {
  requestResume: ReturnType<typeof vi.fn>;
  notifyHidden: ReturnType<typeof vi.fn>;
  notifyVisible: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
} {
  return {
    requestResume: vi.fn(),
    notifyHidden: vi.fn(),
    notifyVisible: vi.fn(),
    dispose: vi.fn(),
  };
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

describe('installResumeLifecycle (jsdom E2E)', () => {
  beforeEach(() => {
    setVisibility('visible');
  });

  it('maps window pageshow/focus/online to requestResume + onVisibleWake', () => {
    const scheduler = makeSpyScheduler();
    const onVisibleWake = vi.fn();
    const dispose = installResumeLifecycle(scheduler, { onVisibleWake });

    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));

    expect(scheduler.requestResume.mock.calls.map((c) => c[0])).toEqual([
      'pageshow',
      'focus',
      'online',
    ]);
    expect(onVisibleWake.mock.calls.map((c) => c[0])).toEqual([
      'pageshow',
      'focus',
      'online',
    ]);
    dispose();
  });

  it('visibilitychange→hidden calls notifyHidden + onHiddenWake (not requestResume)', () => {
    const scheduler = makeSpyScheduler();
    const onHiddenWake = vi.fn();
    const dispose = installResumeLifecycle(scheduler, { onHiddenWake });

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(scheduler.notifyHidden).toHaveBeenCalledTimes(1);
    expect(onHiddenWake).toHaveBeenCalledWith('hidden');
    expect(scheduler.notifyVisible).not.toHaveBeenCalled();
    expect(scheduler.requestResume).not.toHaveBeenCalled();
    dispose();
  });

  it('visibilitychange→visible calls notifyVisible then requestResume + onVisibleWake', () => {
    const scheduler = makeSpyScheduler();
    const onVisibleWake = vi.fn();
    const dispose = installResumeLifecycle(scheduler, { onVisibleWake });

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(scheduler.notifyVisible).toHaveBeenCalledTimes(1);
    expect(scheduler.requestResume).toHaveBeenCalledWith('visibilitychange');
    expect(onVisibleWake).toHaveBeenCalledWith('visibilitychange');
    dispose();
  });

  it('the field churn burst produces hidden/visible notifications, never a stray invalidate path', () => {
    const scheduler = makeSpyScheduler();
    const dispose = installResumeLifecycle(scheduler);

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));

    expect(scheduler.notifyHidden).toHaveBeenCalledTimes(1);
    expect(scheduler.notifyVisible).toHaveBeenCalledTimes(2);
    // 2 visibilitychange→visible + 1 focus
    expect(scheduler.requestResume).toHaveBeenCalledTimes(3);
    dispose();
  });

  it('disposer removes all listeners and disposes the scheduler', () => {
    const scheduler = makeSpyScheduler();
    const dispose = installResumeLifecycle(scheduler);
    dispose();

    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));

    expect(scheduler.requestResume).not.toHaveBeenCalled();
    expect(scheduler.notifyHidden).not.toHaveBeenCalled();
    expect(scheduler.dispose).toHaveBeenCalledTimes(1);

    dispose(); // idempotent
    expect(scheduler.dispose).toHaveBeenCalledTimes(1);
  });
});
