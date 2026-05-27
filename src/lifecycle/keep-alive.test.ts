import { describe, it, expect, vi } from 'vitest';
import { createKeepAlive } from './keep-alive';

// @regression — the keep-alive port mirrors EvenChess's mechanism: it must
// stay idempotent, never throw when AudioContext is missing, and tear down
// cleanly. Activation runs from a user gesture in app.ts (handleHubEvent).
type Mock = ReturnType<typeof vi.fn>;
function makeStubAudioCtx(): { ctx: unknown; calls: { connect: Mock; start: Mock; stop: Mock; disconnect: Mock; close: Mock; resume: Mock } } {
  const listeners: Array<() => void> = [];
  const start = vi.fn();
  const stop = vi.fn();
  const disconnect = vi.fn();
  const close = vi.fn();
  const resume = vi.fn(() => Promise.resolve());
  const connect = vi.fn();
  const osc = { frequency: { value: 0 }, connect, start, stop };
  const gain = { gain: { value: 0 }, connect, disconnect };
  const ctx = {
    state: 'running' as 'running' | 'suspended',
    destination: {},
    createOscillator: () => osc,
    createGain: () => gain,
    addEventListener: (_t: string, cb: () => void) => { listeners.push(cb); },
    resume,
    close,
  };
  return { ctx, calls: { connect, start, stop, disconnect, close, resume } };
}

describe('@regression keep-alive', () => {
  it('activates exactly once: oscillator started + isActive flips to true', () => {
    const { ctx, calls } = makeStubAudioCtx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const k = createKeepAlive({ audioContextCtor: (function () { return ctx; }) as any });
    expect(k.isActive()).toBe(false);
    k.activate();
    expect(k.isActive()).toBe(true);
    expect(calls.start).toHaveBeenCalledTimes(1);
    // Second call is a no-op (no extra oscillator).
    k.activate();
    expect(calls.start).toHaveBeenCalledTimes(1);
  });

  it('deactivate stops + disconnects + closes; isActive flips back; safe to call without activate', () => {
    const { ctx, calls } = makeStubAudioCtx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const k = createKeepAlive({ audioContextCtor: (function () { return ctx; }) as any });
    // No-op before activate (no throw).
    k.deactivate();
    expect(k.isActive()).toBe(false);
    expect(calls.stop).not.toHaveBeenCalled();
    k.activate();
    k.deactivate();
    expect(calls.stop).toHaveBeenCalledTimes(1);
    expect(calls.disconnect).toHaveBeenCalledTimes(1);
    expect(calls.close).toHaveBeenCalledTimes(1);
    expect(k.isActive()).toBe(false);
    // Repeated deactivate stays safe (no throw, no extra teardown).
    k.deactivate();
    expect(calls.stop).toHaveBeenCalledTimes(1);
  });

  it('activate is a safe no-op when AudioContext is unavailable (logs only)', () => {
    const log = vi.fn();
    const k = createKeepAlive({ audioContextCtor: null, requestLock: null, log });
    expect(() => k.activate()).not.toThrow();
    expect(k.isActive()).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('AudioContext unsupported'));
  });

  it('requests the named Web Lock when a lock manager is provided', () => {
    const { ctx } = makeStubAudioCtx();
    const requestLock = vi.fn(() => new Promise<void>(() => undefined));
    const k = createKeepAlive({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      audioContextCtor: (function () { return ctx; }) as any,
      requestLock: requestLock as never,
    });
    k.activate();
    expect(requestLock).toHaveBeenCalledTimes(1);
    expect(requestLock).toHaveBeenCalledWith(
      'smartthings_controls_keep_alive',
      expect.any(Function),
    );
  });
});
