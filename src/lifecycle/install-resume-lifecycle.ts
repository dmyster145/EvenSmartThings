/**
 * DOM wiring for the resume scheduler. Thin and side-effect-isolated so it
 * can be exercised with jsdom in an E2E test. Mirrors the four triggers the
 * app previously wired inline in initApp():
 *   - document `visibilitychange` (hidden vs visible branches)
 *   - window `pageshow` / `focus` / `online`
 */

import type { ResumeScheduler } from './resume-scheduler';

export interface InstallResumeLifecycleOpts {
  /** Defaults to globalThis.document. */
  documentRef?: Document;
  /** Defaults to globalThis.window. */
  windowRef?: Window;
  /** Fired on every "visible" signal (e.g. requestWakeLock). */
  onVisibleWake?: (reason: string) => void;
  /** Fired when the document goes hidden (e.g. releaseWakeLock). */
  onHiddenWake?: (reason: string) => void;
}

/** Wire the scheduler to DOM lifecycle events. Returns a disposer that
 *  removes every listener and disposes the scheduler. */
export function installResumeLifecycle(
  scheduler: ResumeScheduler,
  opts: InstallResumeLifecycleOpts = {},
): () => void {
  const doc: Document | undefined =
    opts.documentRef ?? (typeof document !== 'undefined' ? document : undefined);
  const win: Window | undefined =
    opts.windowRef ?? (typeof window !== 'undefined' ? window : undefined);

  const visibilityHandler = (): void => {
    if (doc && doc.visibilityState === 'hidden') {
      opts.onHiddenWake?.('hidden');
      scheduler.notifyHidden();
      return;
    }
    opts.onVisibleWake?.('visibilitychange');
    scheduler.notifyVisible();
    scheduler.requestResume('visibilitychange');
  };
  const pageshowHandler = (): void => {
    opts.onVisibleWake?.('pageshow');
    scheduler.requestResume('pageshow');
  };
  const focusHandler = (): void => {
    opts.onVisibleWake?.('focus');
    scheduler.requestResume('focus');
  };
  const onlineHandler = (): void => {
    opts.onVisibleWake?.('online');
    scheduler.requestResume('online');
  };

  if (doc && typeof doc.addEventListener === 'function') {
    doc.addEventListener('visibilitychange', visibilityHandler);
  }
  if (win && typeof win.addEventListener === 'function') {
    win.addEventListener('pageshow', pageshowHandler);
    win.addEventListener('focus', focusHandler);
    win.addEventListener('online', onlineHandler);
  }

  let disposed = false;
  return function disposeResumeLifecycle(): void {
    if (disposed) return;
    disposed = true;
    if (doc && typeof doc.removeEventListener === 'function') {
      doc.removeEventListener('visibilitychange', visibilityHandler);
    }
    if (win && typeof win.removeEventListener === 'function') {
      win.removeEventListener('pageshow', pageshowHandler);
      win.removeEventListener('focus', focusHandler);
      win.removeEventListener('online', onlineHandler);
    }
    scheduler.dispose();
  };
}
