/**
 * "Has this user authenticated before?" signal.
 *
 * WebView localStorage is wiped between launches on the device, so the bearer
 * token often isn't readable on cold start even for long-time users — the
 * persisted pending-auth id (restored from Even bridge storage) or a URL
 * session token from an OAuth callback are the surviving signals. When any of
 * these is present we proceed optimistically (paint menu + load data) and
 * verify the session in the background instead of blocking startup on the
 * /api/session network round trip.
 *
 * Extracted so the optimistic-startup path and the session-failure fallback
 * path use the exact same predicate (they must agree), and so it's unit
 * testable.
 */

export interface CredentialSignals {
  /** Bearer token readable from storage right now. */
  restoredToken?: string | null;
  /** Session token present in the launch URL (OAuth callback). */
  urlSessionToken?: string | null;
  /** Persisted pending-auth id (survives WebView restarts via bridge storage). */
  pendingId?: string | null;
}

export function hasCredentialSignal(signals: CredentialSignals): boolean {
  return (
    !!signals.restoredToken ||
    !!signals.urlSessionToken ||
    !!signals.pendingId
  );
}
