import { URL } from 'node:url';
import {
  clearSessionCookie,
  json,
  methodNotAllowed,
  parseCookies,
  redirect,
  setSessionCookie,
} from './http-utils.js';
import { getServerConfig, isSmartThingsConfigured } from './config.js';
import { createSessionStore } from './session-store.js';
import { buildAuthorizeUrl, ensureFreshSession, exchangeAuthorizationCode } from './smartthings-oauth.js';

const config = getServerConfig();
const store = createSessionStore(config);

function isHttpsRequest(request) {
  const forwardedProto = request.headers['x-forwarded-proto'];
  if (typeof forwardedProto === 'string') {
    return forwardedProto.split(',')[0].trim().toLowerCase() === 'https';
  }
  return Boolean(request.socket?.encrypted) || config.publicAppUrl.startsWith('https://');
}

function getRequestOrigin(request) {
  if (typeof request.headers.host === 'string' && request.headers.host) {
    const protocol = isHttpsRequest(request) ? 'https' : 'http';
    return `${protocol}://${request.headers.host}`;
  }
  return config.publicAppUrl;
}

function getSessionCookieOptions(request) {
  return {
    secure: isHttpsRequest(request),
    maxAgeSeconds: config.sessionTtlSeconds,
  };
}

function normalizeReturnToPath(value) {
  if (typeof value !== 'string' || !value) return '/';
  if (!value.startsWith('/')) return '/';
  if (value.startsWith('//')) return '/';
  return value;
}

function sessionSummary(session) {
  return {
    connectedAt: session.createdAt,
    expiresAt: session.expiresAt,
    scope: session.scope,
    tokenType: session.tokenType,
  };
}

async function getAuthenticatedSession(request) {
  const cookies = parseCookies(request);
  const sessionId = cookies[config.sessionCookieName];
  if (!sessionId) return null;
  const session = await store.getSession(sessionId);
  if (!session) return null;
  return ensureFreshSession(config, store, session);
}

function serverConfigurationSummary() {
  return {
    configured: isSmartThingsConfigured(config),
    redirectUri: config.smartThings.redirectUri,
    scopes: config.smartThings.scopes,
    authorizePath: '/api/auth/smartthings/start',
    storageDriver: config.storageDriver,
  };
}

function sendServerError(response, err) {
  console.error('[smartthings-controls-server] request failed:', err);
  return json(response, 500, {
    error: err instanceof Error ? err.message : 'Unknown server error',
  });
}

export async function handleHealthRequest(request, response) {
  try {
    if (request.method !== 'GET') return methodNotAllowed(response, ['GET']);
    return json(response, 200, {
      ok: true,
      serverTime: new Date().toISOString(),
      storageDriver: config.storageDriver,
    });
  } catch (err) {
    return sendServerError(response, err);
  }
}

export async function handleSessionRequest(request, response) {
  try {
    const url = new URL(request.url ?? '/', getRequestOrigin(request));

    if (request.method === 'GET') {
      const session = await getAuthenticatedSession(request);
      if (!session) {
        return json(response, 200, {
          authenticated: false,
          ...serverConfigurationSummary(),
        });
      }
      return json(response, 200, {
        authenticated: true,
        ...serverConfigurationSummary(),
        session: sessionSummary(session),
      });
    }

    if (request.method === 'POST' && url.searchParams.get('action') === 'logout') {
      const cookies = parseCookies(request);
      await store.deleteSession(cookies[config.sessionCookieName]);
      clearSessionCookie(response, config.sessionCookieName, getSessionCookieOptions(request));
      return json(response, 200, { authenticated: false });
    }

    return methodNotAllowed(response, ['GET', 'POST']);
  } catch (err) {
    return sendServerError(response, err);
  }
}

export async function handleSessionLogoutRequest(request, response) {
  try {
    if (request.method !== 'POST') return methodNotAllowed(response, ['POST']);
    const cookies = parseCookies(request);
    await store.deleteSession(cookies[config.sessionCookieName]);
    clearSessionCookie(response, config.sessionCookieName, getSessionCookieOptions(request));
    return json(response, 200, { authenticated: false });
  } catch (err) {
    return sendServerError(response, err);
  }
}

export async function handleAccessTokenRequest(request, response) {
  try {
    if (request.method !== 'GET') return methodNotAllowed(response, ['GET']);
    const session = await getAuthenticatedSession(request);
    if (!session) {
      return json(response, 401, {
        error: 'Not authenticated',
        ...serverConfigurationSummary(),
      });
    }
    return json(response, 200, {
      accessToken: session.accessToken,
      expiresAt: session.expiresAt,
      scope: session.scope,
      tokenType: session.tokenType,
    });
  } catch (err) {
    return sendServerError(response, err);
  }
}

export async function handleAuthStartRequest(request, response) {
  try {
    if (request.method !== 'GET') return methodNotAllowed(response, ['GET']);
    if (!isSmartThingsConfigured(config)) {
      return json(response, 500, {
        error: 'SmartThings OAuth is not configured on the server',
        ...serverConfigurationSummary(),
      });
    }

    const url = new URL(request.url ?? '/', getRequestOrigin(request));
    const returnTo = normalizeReturnToPath(url.searchParams.get('return_to'));
    const state = await store.createOAuthState(returnTo);
    return redirect(response, buildAuthorizeUrl(config, state));
  } catch (err) {
    return sendServerError(response, err);
  }
}

export async function handleAuthCallbackRequest(request, response) {
  try {
    if (request.method !== 'GET') return methodNotAllowed(response, ['GET']);
    if (!isSmartThingsConfigured(config)) {
      return json(response, 500, {
        error: 'SmartThings OAuth is not configured on the server',
        ...serverConfigurationSummary(),
      });
    }

    const url = new URL(request.url ?? '/', getRequestOrigin(request));
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) {
      return json(response, 400, { error: 'Missing code or state' });
    }

    const oauthState = await store.consumeOAuthState(state);
    if (!oauthState) {
      return json(response, 400, { error: 'Invalid or expired OAuth state' });
    }

    const tokenSet = await exchangeAuthorizationCode(config, code);
    const session = await store.createSession(tokenSet);
    setSessionCookie(response, config.sessionCookieName, session.sessionId, getSessionCookieOptions(request));
    return redirect(response, normalizeReturnToPath(oauthState.returnTo));
  } catch (err) {
    return sendServerError(response, err);
  }
}
