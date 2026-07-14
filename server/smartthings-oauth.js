function basicAuthHeader(clientId, clientSecret) {
  return 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
}

const FALLBACK_EXPIRY_SECONDS = 86400; // 24 h — used when SmartThings omits or returns 0 for expires_in

function computeExpiry(expiresInSeconds) {
  const seconds = Number(expiresInSeconds);
  const effective = Number.isFinite(seconds) && seconds > 60 ? seconds : FALLBACK_EXPIRY_SECONDS;
  return new Date(Date.now() + effective * 1000).toISOString();
}

async function exchangeToken(config, params) {
  const response = await fetch(config.smartThings.tokenUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: basicAuthHeader(config.smartThings.clientId, config.smartThings.clientSecret),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload.error_description === 'string'
      ? payload.error_description
      : typeof payload.error === 'string'
        ? payload.error
        : `SmartThings token exchange failed with status ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    const oauthError = typeof payload.error === 'string' ? payload.error : '';
    err.oauthError = oauthError;
    // Distinguish a definitive rejection (the refresh token is dead — expired,
    // revoked, or already consumed by a rotation) from a transient failure
    // (5xx, rate limit, network). Only the former should invalidate the stored
    // session; a transient blip must not log the user out. `invalid_grant` is
    // OAuth's canonical "this grant / refresh token is no longer valid" signal.
    err.isAuthError = oauthError === 'invalid_grant' || response.status === 401 || response.status === 403;
    throw err;
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: computeExpiry(payload.expires_in),
    scope: payload.scope ?? config.smartThings.scopes,
    tokenType: payload.token_type ?? 'Bearer',
  };
}

export function buildAuthorizeUrl(config, state) {
  const params = new URLSearchParams({
    client_id: config.smartThings.clientId,
    response_type: 'code',
    redirect_uri: config.smartThings.redirectUri,
    scope: config.smartThings.scopes,
    state,
  });
  return `${config.smartThings.authorizeUrl}?${params.toString()}`;
}

export async function exchangeAuthorizationCode(config, code) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.smartThings.redirectUri,
    client_id: config.smartThings.clientId,
  });
  return exchangeToken(config, params);
}

export async function refreshAccessToken(config, refreshToken) {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.smartThings.clientId,
    refresh_token: refreshToken,
  });
  return exchangeToken(config, params);
}

// Refresh once the access token is expired or within this window of expiring.
const REFRESH_SKEW_MS = 60_000;

/**
 * True when a session's access token is missing/expired or close enough to
 * expiry that it should be refreshed before use. Exported so the request layer
 * can tell whether a session another request left behind is already fresh.
 */
export function sessionNeedsRefresh(session) {
  const expiresAtMs = Date.parse(session?.expiresAt ?? '');
  return Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now() + REFRESH_SKEW_MS;
}

// In-process single-flight for token refreshes, keyed by sessionId. On app open
// the client fires several authenticated requests in parallel (session, scenes,
// rooms, devices). SmartThings refresh tokens are single-use and rotate on every
// refresh, so if each request refreshed independently only the first would
// succeed and the rest would get `invalid_grant` — needlessly invalidating a
// session that was just refreshed. Coalescing to one refresh per session per
// process removes that self-inflicted race within an instance.
const inFlightRefreshes = new Map();

export async function ensureFreshSession(config, store, session) {
  if (!sessionNeedsRefresh(session)) return session;
  // PAT sessions have no refreshToken — cannot be refreshed. Return as-is; if the PAT
  // is expired/revoked the next SmartThings API call will fail with 401 and the session
  // will be cleared by the caller.
  if (!session.refreshToken) return session;

  const key = session.sessionId;
  const existing = key ? inFlightRefreshes.get(key) : null;
  if (existing) return existing;

  const refreshPromise = (async () => {
    const refreshed = await refreshAccessToken(config, session.refreshToken);
    const nextSession = {
      ...session,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken || session.refreshToken,
      expiresAt: refreshed.expiresAt,
      scope: refreshed.scope,
      tokenType: refreshed.tokenType,
    };
    return store.putSession(nextSession);
  })();

  if (key) {
    inFlightRefreshes.set(key, refreshPromise);
    // Clear the slot once settled so a later (post-rotation) refresh can run.
    // Swallow here so the cleanup chain never surfaces an unhandled rejection;
    // the awaited callers still observe the real outcome.
    refreshPromise
      .catch(() => {})
      .finally(() => {
        if (inFlightRefreshes.get(key) === refreshPromise) inFlightRefreshes.delete(key);
      });
  }

  return refreshPromise;
}
