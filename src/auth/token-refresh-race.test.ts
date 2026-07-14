import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// The server OAuth helpers are plain ESM JS; import directly. This file lives
// under src/ only so the default vitest include (src/**/*.test.ts) picks it up —
// it is excluded from the app tsconfig, so the untyped .js import is fine.
// @ts-expect-error — no type declarations for the server JS module.
import { ensureFreshSession, sessionNeedsRefresh } from '../../server/smartthings-oauth.js';

// @regression — locks the fix for spurious re-authentication. On app open the
// client fires several authenticated requests in parallel; SmartThings refresh
// tokens are single-use, so independent refreshes would race, one wins and the
// losers get invalid_grant. Previously each loser deleted the whole session,
// forcing a reconnect roughly every day. ensureFreshSession must now coalesce
// concurrent refreshes into one, and classify auth vs transient failures.

const CONFIG = {
  smartThings: {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    tokenUrl: 'https://token.example/oauth/token',
    scopes: 'r:scenes:*',
  },
};

function expiredSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 's1',
    accessToken: 'access-old',
    refreshToken: 'refresh-1',
    // Expired an hour ago → needs refresh.
    expiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    scope: 'r:scenes:*',
    tokenType: 'Bearer',
    ...overrides,
  };
}

function freshTokenResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      access_token: 'access-new',
      refresh_token: 'refresh-2',
      expires_in: 86400,
      scope: 'r:scenes:*',
      token_type: 'Bearer',
    }),
  };
}

// Flush pending microtasks (the single-flight cleanup runs in a .finally chain).
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('@regression sessionNeedsRefresh', () => {
  it('is true for expired / missing expiry and false for a comfortably fresh token', () => {
    expect(sessionNeedsRefresh(expiredSession())).toBe(true);
    expect(sessionNeedsRefresh({ expiresAt: undefined })).toBe(true);
    expect(sessionNeedsRefresh({ expiresAt: 'not-a-date' })).toBe(true);
    expect(
      sessionNeedsRefresh({ expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() })
    ).toBe(false);
  });

  it('is true within the 60s pre-expiry skew window', () => {
    expect(sessionNeedsRefresh({ expiresAt: new Date(Date.now() + 30 * 1000).toISOString() })).toBe(true);
  });
});

describe('@regression ensureFreshSession single-flight', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let putSession: ReturnType<typeof vi.fn>;
  let store: { putSession: typeof putSession };

  beforeEach(() => {
    fetchSpy = vi.fn(async () => freshTokenResponse());
    vi.stubGlobal('fetch', fetchSpy);
    putSession = vi.fn(async (session: Record<string, unknown>) => ({ ...session, updatedAt: 'now' }));
    store = { putSession };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('coalesces concurrent refreshes for the same session into a single token exchange', async () => {
    const session = expiredSession();
    const [a, b, c] = await Promise.all([
      ensureFreshSession(CONFIG, store, session),
      ensureFreshSession(CONFIG, store, session),
      ensureFreshSession(CONFIG, store, session),
    ]);

    // Only ONE network refresh, even though three requests raced.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(putSession).toHaveBeenCalledTimes(1);
    // All callers get the same freshly-rotated session.
    expect(a.accessToken).toBe('access-new');
    expect(a.refreshToken).toBe('refresh-2');
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('releases the single-flight slot after settling so a later refresh can run', async () => {
    const session = expiredSession();
    await ensureFreshSession(CONFIG, store, session);
    await flush();
    // A subsequent refresh (token expired again) must fire a fresh exchange, not
    // reuse the completed in-flight promise.
    await ensureFreshSession(CONFIG, store, expiredSession({ refreshToken: 'refresh-2' }));
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('does not refresh when the token is still fresh', async () => {
    const fresh = expiredSession({ expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
    const result = await ensureFreshSession(CONFIG, store, fresh);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toBe(fresh);
  });

  it('does not refresh PAT sessions that have no refresh token', async () => {
    const pat = expiredSession({ refreshToken: null });
    const result = await ensureFreshSession(CONFIG, store, pat);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toBe(pat);
  });
});

describe('@regression ensureFreshSession error classification', () => {
  let putSession: ReturnType<typeof vi.fn>;
  let store: { putSession: typeof putSession };

  beforeEach(() => {
    putSession = vi.fn(async (session: Record<string, unknown>) => session);
    store = { putSession };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('marks invalid_grant (dead refresh token) as a definitive auth error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 400,
        json: async () => ({ error: 'invalid_grant', error_description: 'token expired' }),
      }))
    );
    // Fresh session object each call so we do not collide with the in-flight slot.
    const err = await ensureFreshSession(CONFIG, store, expiredSession({ sessionId: 'auth-err' })).catch(
      (e: unknown) => e as { isAuthError?: boolean; status?: number }
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.isAuthError).toBe(true);
    expect(err.status).toBe(400);
    expect(putSession).not.toHaveBeenCalled();
  });

  it('marks a 5xx / rate-limit failure as transient (not an auth error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }))
    );
    const err = await ensureFreshSession(CONFIG, store, expiredSession({ sessionId: 'transient' })).catch(
      (e: unknown) => e as { isAuthError?: boolean; status?: number }
    );
    expect(err).toBeInstanceOf(Error);
    expect(err.isAuthError).toBe(false);
    expect(err.status).toBe(503);
  });
});
