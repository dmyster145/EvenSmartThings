function basicAuthHeader(clientId, clientSecret) {
  return 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`, 'utf8').toString('base64');
}

function computeExpiry(expiresInSeconds) {
  const expiresInMs = Math.max(0, Number(expiresInSeconds || 0)) * 1000;
  return new Date(Date.now() + expiresInMs).toISOString();
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
    throw new Error(message);
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

export async function ensureFreshSession(config, store, session) {
  const expiresAtMs = Date.parse(session.expiresAt ?? '');
  const shouldRefresh = Number.isNaN(expiresAtMs) || expiresAtMs <= Date.now() + 60_000;
  if (!shouldRefresh) return session;

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
}
