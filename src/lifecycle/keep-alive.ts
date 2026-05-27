/**
 * WebView keep-alive — reduces aggressive timer/network throttling when the
 * Even App is backgrounded (the same class of throttling that produced our
 * resume churn / sluggish first-command symptoms). Two layered hints:
 *
 *  1. A silent AudioContext oscillator (1 Hz, gain 0.001) — most WebViews
 *     treat active audio as a high-priority task and back off on throttling.
 *  2. A long-lived Web Lock (`smartthings_controls_keep_alive`) — some
 *     Chromium variants use held locks as a hint not to freeze the page.
 *
 * Strictly additive: screen wake-lock (requestWakeLock) is unchanged.
 *
 * Ported from EvenChess src/utils/keep-alive.ts, refactored as a factory with
 * injectable deps so it's unit-testable in node (where AudioContext doesn't
 * exist). app.ts owns the singleton instance. Activation must happen from a
 * user-gesture context (browser autoplay policy) — the caller arms it on the
 * first glasses event in handleHubEvent.
 */

type AudioContextCtor = new () => AudioContext;
type LockRequest = (name: string, callback: () => Promise<void>) => Promise<void>;

export interface KeepAliveDeps {
  /** Defaults to globalThis.AudioContext / webkitAudioContext. */
  audioContextCtor?: AudioContextCtor | null;
  /** Defaults to navigator.locks.request when available. */
  requestLock?: LockRequest | null;
  /** Optional debug-log sink (no-op in tests). */
  log?: (message: string) => void;
}

export interface KeepAlive {
  activate(): void;
  deactivate(): void;
  isActive(): boolean;
}

function defaultAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function defaultRequestLock(): LockRequest | null {
  if (typeof navigator === 'undefined') return null;
  const n = navigator as Navigator & { locks?: { request: LockRequest } };
  return n.locks ? n.locks.request.bind(n.locks) : null;
}

export function createKeepAlive(deps: KeepAliveDeps = {}): KeepAlive {
  const log = deps.log ?? ((): void => undefined);
  const audioContextCtor =
    deps.audioContextCtor === undefined ? defaultAudioContextCtor() : deps.audioContextCtor;
  const requestLock =
    deps.requestLock === undefined ? defaultRequestLock() : deps.requestLock;

  let audioCtx: AudioContext | null = null;
  let oscillator: OscillatorNode | null = null;
  let gainNode: GainNode | null = null;
  let active = false;

  function activate(): void {
    if (active) return;

    // (1) Silent audio oscillator.
    if (audioContextCtor) {
      try {
        audioCtx = new audioContextCtor();
        oscillator = audioCtx.createOscillator();
        gainNode = audioCtx.createGain();
        oscillator.frequency.value = 1;
        gainNode.gain.value = 0.001;
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.start();
        active = true;
        log(`[keep-alive] audio activated state=${audioCtx.state}`);
        audioCtx.addEventListener('statechange', () => {
          log(`[keep-alive] audio statechange=${audioCtx?.state ?? 'null'}`);
          if (audioCtx?.state === 'suspended') {
            audioCtx.resume().catch(() => log('[keep-alive] audio resume failed'));
          }
        });
      } catch (err) {
        audioCtx = null;
        oscillator = null;
        gainNode = null;
        log(`[keep-alive] audio init failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      log('[keep-alive] AudioContext unsupported in this WebView');
    }

    // (2) Web Locks hint. Acquire a long-lived named lock; the callback
    // resolves never (the promise stays pending until deactivate teardown
    // collects audio + lock alike on app close).
    if (requestLock) {
      try {
        void requestLock('smartthings_controls_keep_alive', () => new Promise<void>(() => {
          log('[keep-alive] web-lock acquired');
        })).catch(() => log('[keep-alive] web-lock request failed'));
      } catch {
        // navigator.locks may throw on some old WebViews — best-effort only.
      }
    }
  }

  function deactivate(): void {
    if (oscillator) {
      try { oscillator.stop(); } catch { /* already stopped */ }
      oscillator = null;
    }
    if (gainNode) {
      try { gainNode.disconnect(); } catch { /* already disconnected */ }
      gainNode = null;
    }
    if (audioCtx) {
      try { void audioCtx.close(); } catch { /* already closed */ }
      audioCtx = null;
    }
    if (active) {
      active = false;
      log('[keep-alive] deactivated');
    }
  }

  return {
    activate,
    deactivate,
    isActive: () => active,
  };
}
