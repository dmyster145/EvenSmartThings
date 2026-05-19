import { URL } from 'node:url';
import {
  applyCors,
  clearSessionCookie,
  handlePreflightIfNeeded,
  json,
  makeOpaqueId,
  methodNotAllowed,
  parseCookies,
  parseSessionFromBearer,
  readJsonBody,
  redirect,
  setSessionCookie,
} from './http-utils.js';
import { getServerConfig, isSmartThingsConfigured } from './config.js';
import { createSessionStore } from './session-store.js';
import { buildAuthorizeUrl, ensureFreshSession, exchangeAuthorizationCode } from './smartthings-oauth.js';
import { VOICE_CONFIG_PAYLOAD } from './voice-config.js';

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

function shouldTouchSession(session) {
  const updatedAtMs = Date.parse(session?.updatedAt ?? session?.createdAt ?? '');
  if (Number.isNaN(updatedAtMs)) return true;
  return updatedAtMs <= Date.now() - config.rollingSessionTouchIntervalSeconds * 1000;
}

function isTrustedReturnToUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.origin === config.publicAppUrl) return true;
    // Loopback
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(parsed.origin)) return true;
    // RFC 1918 private / LAN addresses (http only — dev servers won't have TLS certs).
    // Covers 192.168.x.x, 10.x.x.x, 172.16–31.x.x, and 169.254.x.x link-local.
    // Allows QR-code / phone testing against a local Vite dev server without
    // needing a per-machine env var that changes on every network switch.
    if (/^http:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(parsed.origin)) return true;
    return false;
  } catch {
    return false;
  }
}

function isTrustedAppUrl(value) {
  // app_url is only ever a localhost address (the ehpk WebView port).
  // Reject anything else to prevent the session token being redirected
  // to an attacker-controlled domain via a crafted return_to param.
  if (typeof value !== 'string' || !value) return false;
  try {
    const parsed = new URL(value);
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(parsed.origin);
  } catch {
    return false;
  }
}

function normalizeReturnTo(value) {
  if (typeof value !== 'string' || !value) return '/';
  // Allow full trusted URLs (e.g. http://localhost:5173/)
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return isTrustedReturnToUrl(value) ? value : '/';
  }
  // Otherwise require a safe relative path
  if (!value.startsWith('/') || value.startsWith('//')) return '/';
  // Strip any app_url param that doesn't point to a trusted localhost address.
  // normalizeReturnTo validates the outer return_to but not nested params;
  // an attacker could embed app_url=https://evil.com in a relative path that
  // passes the leading-slash check above, then steal the _st token client-side.
  try {
    const parsed = new URL(value, 'http://localhost');
    const appUrl = parsed.searchParams.get('app_url');
    if (appUrl !== null && !isTrustedAppUrl(appUrl)) {
      parsed.searchParams.delete('app_url');
      return parsed.pathname + (parsed.search ? parsed.search : '');
    }
  } catch {
    // ignore — return value as-is
  }
  return value;
}

function getSmartAppTargetUrl(request) {
  const url = new URL(request.url ?? '/', getRequestOrigin(request));
  return `${getRequestOrigin(request)}${url.pathname}`;
}

function getSmartAppInitializeResponse() {
  return {
    configurationData: {
      initialize: {
        name: 'SmartThings Control',
        description: 'SmartThings Control for Even Realities G2 glasses',
        id: 'smartthings-controls',
        permissions: [],
        firstPageId: 'main',
      },
    },
  };
}

function getSmartAppPageResponse(pageId) {
  return {
    configurationData: {
      page: {
        pageId: pageId || 'main',
        name: 'SmartThings Control',
        nextPageId: null,
        previousPageId: null,
        complete: true,
        sections: [
          {
            name: 'Authorization',
            settings: [
              {
                id: 'smartthings-controls-info',
                name: 'Finish setup in Even App',
                description: 'Tap Done to continue',
                type: 'PARAGRAPH',
                defaultValue: 'Use the Even App to connect SmartThings and finish authorization.',
              },
            ],
          },
        ],
      },
    },
  };
}

async function acknowledgeSmartAppConfirmation(body) {
  const confirmationUrl = body?.confirmationData?.confirmationUrl;
  if (typeof confirmationUrl !== 'string' || !confirmationUrl) return;

  try {
    const response = await fetch(confirmationUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });
    if (!response.ok) {
      console.warn(
        '[smartthings-controls-server] SmartApp confirmation GET failed:',
        response.status,
        response.statusText
      );
    }
  } catch (err) {
    console.warn('[smartthings-controls-server] SmartApp confirmation GET failed:', err);
  }
}

function sessionSummary(session) {
  return {
    connectedAt: session.createdAt,
    expiresAt: session.expiresAt,
    scope: session.scope,
    tokenType: session.tokenType,
  };
}

// Sentinel returned when a session existed but the refresh token was rejected.
// Callers that only care about authentication treat this the same as null;
// handleSessionRequest also surfaces it as sessionExpired: true to the client.
const REFRESH_EXPIRED = Object.freeze({ __refreshExpired: true });

async function getAuthenticatedSession(request) {
  const cookies = parseCookies(request);
  const sessionId = cookies[config.sessionCookieName] || parseSessionFromBearer(request);
  if (!sessionId) return null;
  let session = await store.getSession(sessionId);
  if (!session) return null;
  try {
    session = await ensureFreshSession(config, store, session);
  } catch (err) {
    // Token refresh failed (e.g. refresh token expired after 30 days of inactivity,
    // or SmartThings rejected it). Clear the dead session and return a sentinel so
    // the session endpoint can inform the client to show a specific "expired" message.
    console.warn('[smartthings-controls-server] Token refresh failed; clearing session:', err);
    await store.deleteSession(sessionId).catch(() => {});
    return REFRESH_EXPIRED;
  }
  if (shouldTouchSession(session)) {
    session = (await store.touchSession(sessionId)) ?? session;
  }
  return session;
}

function refreshSessionCookie(response, request, session) {
  if (!session?.sessionId) return;
  setSessionCookie(response, config.sessionCookieName, session.sessionId, getSessionCookieOptions(request));
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

const SMARTTHINGS_API_BASE_URL = 'https://api.smartthings.com/v1';

function smartThingsErrorMessage(payload, status) {
  if (typeof payload?.message === 'string' && payload.message) return payload.message;
  if (typeof payload?.error === 'string' && payload.error) return payload.error;
  return `SmartThings request failed with status ${status}`;
}

function describeFetchCause(err) {
  // Node/undici wraps connection failures as `TypeError: fetch failed` with
  // the real reason in err.cause. Surface it so "fetch failed" stops being
  // an opaque dead end.
  const cause = err && err.cause ? err.cause : null;
  const parts = [];
  if (err && err.name) parts.push(err.name);
  if (cause && cause.code) parts.push(`code=${cause.code}`);
  if (cause && cause.errno !== undefined) parts.push(`errno=${cause.errno}`);
  if (cause && cause.message) parts.push(`cause=${cause.message}`);
  else if (err && err.message) parts.push(`msg=${err.message}`);
  return parts.join(' ') || String(err);
}

async function smartThingsApiRequest(session, pathOrUrl, options = {}) {
  // Accept either a relative path ("/scenes") or an absolute URL — SmartThings
  // pagination `_links.next.href` values are absolute, so following them must
  // not re-prepend the API base.
  const url =
    typeof pathOrUrl === 'string' && pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `${SMARTTHINGS_API_BASE_URL}${pathOrUrl}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 12000);
  let response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${session.accessToken}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      redirect: 'follow',
    });
  } catch (err) {
    // Connection-layer failure (DNS / TLS / reset / abort / bad redirect).
    return {
      ok: false,
      status: 502,
      payload: {},
      networkError: describeFetchCause(err),
    };
  } finally {
    clearTimeout(timeout);
  }
  const payload = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

function didSmartThingsCommandSucceed(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  if (results.some((entry) => entry?.status === 'FAILED')) return false;
  if (typeof payload?.status === 'string') {
    const normalized = payload.status.toLowerCase();
    if (normalized === 'failed' || normalized === 'error') return false;
  }
  return true;
}

function getRelayRequestContext(body) {
  const requestId =
    typeof body?.requestId === 'string' && body.requestId.trim()
      ? body.requestId.trim()
      : makeOpaqueId();
  const kind = typeof body?.kind === 'string' ? body.kind : 'unknown';
  const clientTransport = typeof body?.clientTransport === 'string' ? body.clientTransport : 'unknown';
  const clientVisibility = typeof body?.clientVisibility === 'string' ? body.clientVisibility : 'unknown';
  const clientIssuedAt = typeof body?.clientIssuedAt === 'string' ? body.clientIssuedAt : '';
  const issuedAtMs = Date.parse(clientIssuedAt);
  const lagMs = Number.isFinite(issuedAtMs) ? Date.now() - issuedAtMs : null;
  return {
    requestId,
    kind,
    clientTransport,
    clientVisibility,
    clientIssuedAt,
    lagMs,
  };
}

function relayContextLine(context, extra = '') {
  const lagPart = context.lagMs == null ? 'lagMs=unknown' : `lagMs=${context.lagMs}`;
  return `requestId=${context.requestId} kind=${context.kind} transport=${context.clientTransport} visibility=${context.clientVisibility} ${lagPart}${extra ? ` ${extra}` : ''}`;
}

function logRelay(event, context, extra = '') {
  console.log(`[smartthings-controls-relay] ${event} ${relayContextLine(context, extra)}`);
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

/**
 * Public voice grammar/tunables config. No auth, cacheable. The shared json()
 * helper forces Cache-Control: no-store, so this writes its own head to allow
 * a 1h CDN/client cache (the config rarely changes; the client also keeps an
 * on-device copy + bundled fallback).
 */
export async function handleVoiceConfigRequest(request, response) {
  try {
    if (handlePreflightIfNeeded(response, request, config.publicAppUrl)) return;
    applyCors(response, request, config.publicAppUrl);
    if (request.method !== 'GET') return methodNotAllowed(response, ['GET']);
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    });
    response.end(JSON.stringify(VOICE_CONFIG_PAYLOAD));
  } catch (err) {
    return sendServerError(response, err);
  }
}

export async function handleSessionRequest(request, response) {
  try {
    if (handlePreflightIfNeeded(response, request, config.publicAppUrl)) return;
    applyCors(response, request, config.publicAppUrl);
    const url = new URL(request.url ?? '/', getRequestOrigin(request));

    if (request.method === 'GET') {
      const session = await getAuthenticatedSession(request);
      if (!session || session === REFRESH_EXPIRED) {
        return json(response, 200, {
          authenticated: false,
          sessionExpired: session === REFRESH_EXPIRED,
          ...serverConfigurationSummary(),
        });
      }
      refreshSessionCookie(response, request, session);
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
    if (handlePreflightIfNeeded(response, request, config.publicAppUrl)) return;
    applyCors(response, request, config.publicAppUrl);
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
    if (handlePreflightIfNeeded(response, request, config.publicAppUrl)) return;
    applyCors(response, request, config.publicAppUrl);
    if (request.method !== 'GET') return methodNotAllowed(response, ['GET']);
    const session = await getAuthenticatedSession(request);
    if (!session || session === REFRESH_EXPIRED) {
      return json(response, 401, {
        error: 'Not authenticated',
        ...serverConfigurationSummary(),
      });
    }
    refreshSessionCookie(response, request, session);
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

export async function handleSmartThingsExecuteRequest(request, response) {
  try {
    if (handlePreflightIfNeeded(response, request, config.publicAppUrl)) return;
    applyCors(response, request, config.publicAppUrl);
    if (request.method !== 'POST') return methodNotAllowed(response, ['POST']);
    const session = await getAuthenticatedSession(request);
    if (!session || session === REFRESH_EXPIRED) {
      return json(response, 401, {
        error: 'Not authenticated',
        ...serverConfigurationSummary(),
      });
    }
    refreshSessionCookie(response, request, session);

    const body = await readJsonBody(request);
    const relayContext = getRelayRequestContext(body);
    logRelay('received', relayContext);
    const kind = body?.kind;

    if (kind === 'scene') {
      const sceneId = typeof body?.sceneId === 'string' ? body.sceneId.trim() : '';
      if (!sceneId) {
        logRelay('invalid', relayContext, 'reason=missing-sceneId');
        return json(response, 400, { requestId: relayContext.requestId, error: 'sceneId is required' });
      }
      logRelay('dispatch', relayContext, `sceneId=${sceneId}`);
      const result = await smartThingsApiRequest(session, `/scenes/${encodeURIComponent(sceneId)}/execute`, {
        method: 'POST',
      });
      // Ground-truth dump of the EXACT SmartThings scene-execute response.
      // This is the only place a per-device breakdown could appear; the client
      // can only show ! (partial) if this body has mixed FAILED/non-FAILED rows.
      let scenePayloadDump;
      try {
        scenePayloadDump = JSON.stringify(result.payload);
      } catch {
        scenePayloadDump = '<unstringifiable>';
      }
      logRelay(
        'scene-raw',
        relayContext,
        `sceneId=${sceneId} httpStatus=${result.status} ok=${result.ok}`
          + ` keys=${result.payload && typeof result.payload === 'object' ? Object.keys(result.payload).join(',') : 'n/a'}`
          + ` body=${String(scenePayloadDump).slice(0, 2000)}`
      );
      if (!result.ok) {
        logRelay('response', relayContext, `status=${result.status} ok=false`);
        return json(response, result.status, {
          requestId: relayContext.requestId,
          error: smartThingsErrorMessage(result.payload, result.status),
          response: result.payload,
        });
      }
      logRelay('response', relayContext, `status=${result.status} ok=true`);
      return json(response, 200, { requestId: relayContext.requestId, ...result.payload });
    }

    if (kind === 'device') {
      const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : '';
      const capability = typeof body?.capability === 'string' ? body.capability.trim() : '';
      const command = typeof body?.command === 'string' ? body.command.trim() : '';
      const args = Array.isArray(body?.arguments) ? body.arguments : [];
      if (!deviceId || !capability || !command) {
        logRelay('invalid', relayContext, 'reason=missing-device-command-fields');
        return json(response, 400, { requestId: relayContext.requestId, error: 'deviceId, capability, and command are required' });
      }
      logRelay('dispatch', relayContext, `deviceId=${deviceId} capability=${capability} command=${command}`);
      const result = await smartThingsApiRequest(
        session,
        `/devices/${encodeURIComponent(deviceId)}/commands`,
        {
          method: 'POST',
          body: {
            commands: [
              {
                component: 'main',
                capability,
                command,
                arguments: args,
              },
            ],
          },
        }
      );
      if (!result.ok) {
        logRelay('response', relayContext, `status=${result.status} ok=false`);
        return json(response, result.status, {
          requestId: relayContext.requestId,
          error: smartThingsErrorMessage(result.payload, result.status),
          response: result.payload,
        });
      }
      logRelay('response', relayContext, `status=${result.status} ok=true`);
      return json(response, 200, { requestId: relayContext.requestId, ...result.payload });
    }

    if (kind === 'batch-device') {
      const commands = Array.isArray(body?.commands) ? body.commands : [];
      if (commands.length === 0) {
        logRelay('invalid', relayContext, 'reason=missing-batch-commands');
        return json(response, 400, { requestId: relayContext.requestId, error: 'commands is required' });
      }
      logRelay('dispatch', relayContext, `count=${commands.length}`);

      const results = await Promise.all(
        commands.map(async (entry) => {
          const deviceId = typeof entry?.deviceId === 'string' ? entry.deviceId.trim() : '';
          const capability = typeof entry?.capability === 'string' ? entry.capability.trim() : '';
          const command = typeof entry?.command === 'string' ? entry.command.trim() : '';
          const args = Array.isArray(entry?.arguments) ? entry.arguments : [];
          if (!deviceId || !capability || !command) {
            return {
              deviceId,
              ok: false,
              error: 'deviceId, capability, and command are required',
            };
          }
          const result = await smartThingsApiRequest(
            session,
            `/devices/${encodeURIComponent(deviceId)}/commands`,
            {
              method: 'POST',
              body: {
                commands: [
                  {
                    component: 'main',
                    capability,
                    command,
                    arguments: args,
                  },
                ],
              },
            }
          );
          if (!result.ok) {
            return {
              deviceId,
              ok: false,
              error: smartThingsErrorMessage(result.payload, result.status),
            };
          }
          return {
            deviceId,
            ok: didSmartThingsCommandSucceed(result.payload),
            status: typeof result.payload?.status === 'string' ? result.payload.status : undefined,
            results: Array.isArray(result.payload?.results) ? result.payload.results : [],
          };
        })
      );

      logRelay('response', relayContext, `status=200 ok=true count=${results.length}`);
      return json(response, 200, { requestId: relayContext.requestId, results });
    }

    if (kind === 'list-scenes') {
      // Listing scenes direct browser→api.smartthings.com fails with a
      // network-layer error for some accounts, even though rooms/devices/
      // locations succeed. Routing it through the server sidesteps the
      // browser network constraints. SmartThings also leaks INTERNAL
      // hostnames in pagination `_links.next.href` (e.g.
      // alliance.na04.stinternal.net) which aren't publicly resolvable —
      // ENOTFOUND. So we never follow the absolute next href; we keep only
      // its path+query and re-issue against the public api.smartthings.com.
      const toPublicScenesPath = (href) => {
        try {
          const u = new URL(href);
          let path = `${u.pathname}${u.search}`;
          // SMARTTHINGS_API_BASE_URL already ends in /v1 — drop a leading
          // /v1 from the href path so we don't get /v1/v1/scenes.
          if (path.startsWith('/v1/')) path = path.slice(3);
          return path || null;
        } catch {
          return null;
        }
      };
      const locationId = typeof body?.locationId === 'string' ? body.locationId.trim() : '';
      const query = locationId ? `?locationId=${encodeURIComponent(locationId)}` : '';
      logRelay('dispatch', relayContext, `list-scenes locationId=${locationId || 'all'}`);
      const items = [];
      let next = `/scenes${query}`;
      let pageGuard = 0;
      while (next && pageGuard < 25) {
        pageGuard += 1;
        const result = await smartThingsApiRequest(session, next);
        if (!result.ok) {
          const detail = result.networkError
            ? `network: ${result.networkError}`
            : smartThingsErrorMessage(result.payload, result.status);
          logRelay(
            'response',
            relayContext,
            `status=${result.status} ok=false page=${pageGuard} collected=${items.length} ${result.networkError ? `netErr=${result.networkError}` : ''}`
          );
          // If we already collected at least one page, degrade gracefully:
          // return what we have rather than zero scenes.
          if (items.length > 0) {
            logRelay('response', relayContext, `status=200 ok=true partial scenes=${items.length}`);
            return json(response, 200, { requestId: relayContext.requestId, items, partial: true });
          }
          return json(response, result.status, {
            requestId: relayContext.requestId,
            error: `scenes ${detail}`,
            response: result.payload,
          });
        }
        const pageItems = Array.isArray(result.payload?.items) ? result.payload.items : [];
        for (const item of pageItems) items.push(item);
        const nextHref = result.payload?._links?.next?.href;
        next =
          typeof nextHref === 'string' && nextHref ? toPublicScenesPath(nextHref) : null;
      }
      logRelay('response', relayContext, `status=200 ok=true scenes=${items.length} pages=${pageGuard}`);
      return json(response, 200, { requestId: relayContext.requestId, items });
    }

    logRelay('invalid', relayContext, 'reason=unsupported-kind');
    return json(response, 400, { requestId: relayContext.requestId, error: 'Unsupported command kind' });
  } catch (err) {
    return sendServerError(response, err);
  }
}

export async function handleAuthPatRequest(request, response) {
  try {
    if (handlePreflightIfNeeded(response, request, config.publicAppUrl)) return;
    applyCors(response, request, config.publicAppUrl);
    if (request.method !== 'POST') return methodNotAllowed(response, ['POST']);

    const body = await readJsonBody(request);
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    if (!token) {
      return json(response, 400, { error: 'token is required' });
    }

    // Validate the PAT by making a lightweight SmartThings API call.
    let validationResponse;
    try {
      validationResponse = await fetch(`${SMARTTHINGS_API_BASE_URL}/devices?limit=1`, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      console.warn('[smartthings-controls-server] PAT validation network error:', err instanceof Error ? err.message : err);
      return json(response, 502, { error: 'Could not reach SmartThings to validate token' });
    }

    if (!validationResponse.ok) {
      if (validationResponse.status === 401 || validationResponse.status === 403) {
        return json(response, 401, { error: 'Invalid or expired Personal Access Token' });
      }
      return json(response, 502, { error: `SmartThings returned status ${validationResponse.status}` });
    }

    // PAT is valid. Create a session. PAT sessions have no refreshToken; expiresAt is set
    // far in the future — the session stays alive until the PAT is revoked or expires.
    const session = await store.createSession({
      accessToken: token,
      refreshToken: null,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
      scope: config.smartThings.scopes,
      tokenType: 'Bearer',
    });

    const cookieOptions = getSessionCookieOptions(request);
    setSessionCookie(response, config.sessionCookieName, session.sessionId, cookieOptions);
    console.log('[smartthings-controls-server] PAT auth: session created. sessionId=' + session.sessionId.slice(0, 8) + '…');
    return json(response, 200, { sessionId: session.sessionId });
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
    const returnTo = normalizeReturnTo(url.searchParams.get('return_to'));
    const pendingAuthId = url.searchParams.get('pending_auth_id') || null;
    const state = await store.createOAuthState(returnTo, pendingAuthId);
    const authorizeUrl = buildAuthorizeUrl(config, state);

    // On iOS with the Samsung SmartThings app installed, api.smartthings.com/oauth/authorize
    // is registered as a Universal Link across all SmartThings app variants. iOS intercepts
    // the navigation BEFORE any network request is made and opens the native SmartThings app.
    // The native app handles OAuth internally but does NOT forward the authorization code to
    // our redirect_uri, so the session is never created.
    //
    // Bypass: fetch the authorize URL server-side (no Universal Links on the server) with
    // redirect:manual to capture only the first-hop Location header, then send the client
    // directly to that URL (typically account.smartthings.com, which has no AASA/Universal
    // Links registered). The user's browser then shows the web OAuth login page instead of
    // opening the native app.
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      let probeLocation = null;
      try {
        const probe = await fetch(authorizeUrl, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
        });
        if ((probe.status === 301 || probe.status === 302) && probe.headers.get('location')) {
          probeLocation = probe.headers.get('location');
        }
      } finally {
        clearTimeout(timeoutId);
      }
      if (probeLocation) {
        let bypassHostname = probeLocation;
        try { bypassHostname = new URL(probeLocation).hostname; } catch { /* ignore */ }
        console.log('[smartthings-controls-server] Auth start: Universal Link bypass — redirecting client to ' + bypassHostname + ' instead of api.smartthings.com/oauth/authorize');
        return redirect(response, probeLocation);
      }
    } catch (probeErr) {
      console.warn('[smartthings-controls-server] Auth start: bypass probe failed, falling back to direct redirect:', probeErr instanceof Error ? probeErr.message : String(probeErr));
    }

    return redirect(response, authorizeUrl);
  } catch (err) {
    return sendServerError(response, err);
  }
}

export async function handleAuthPendingRequest(request, response) {
  try {
    if (handlePreflightIfNeeded(response, request, config.publicAppUrl)) return;
    applyCors(response, request, config.publicAppUrl);
    if (request.method !== 'GET') return methodNotAllowed(response, ['GET']);

    const url = new URL(request.url ?? '/', getRequestOrigin(request));
    const pendingId = url.searchParams.get('id');
    if (!pendingId) {
      return json(response, 400, { error: 'Missing pending auth id' });
    }

    const sessionId = await store.getPendingAuth(pendingId);
    if (!sessionId) {
      return json(response, 200, { completed: false });
    }

    return json(response, 200, { completed: true, sessionId });
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
      // No code/state — user likely denied/cancelled the SmartThings authorization,
      // or the callback was hit without OAuth params (e.g. a bare prefetch, or the
      // SmartThings native app intercepted the authorize URL via Universal Links and
      // redirected back without forwarding the authorization code).
      const allParams = Object.fromEntries(url.searchParams.entries());
      const ua = (typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : '').slice(0, 200) || 'none';
      const referer = (typeof request.headers['referer'] === 'string' ? request.headers['referer'] : '').slice(0, 200) || 'none';
      console.warn(
        '[smartthings-controls-server] OAuth callback: missing code or state.' +
        ' params=' + JSON.stringify(allParams) +
        ' ua=' + ua +
        ' referer=' + referer
      );
      const fallbackUrl = `${config.publicAppUrl}/auth-complete.html`;
      return redirect(response, fallbackUrl);
    }

    const oauthState = await store.consumeOAuthState(state);
    if (!oauthState) {
      // State not found — expired or never created.
      console.warn('[smartthings-controls-server] OAuth callback: state not found in Redis. state=' + state.slice(0, 8) + '…');
      const fallbackUrl = `${config.publicAppUrl}/auth-complete.html`;
      return redirect(response, fallbackUrl);
    }

    console.log('[smartthings-controls-server] OAuth callback: state found. pendingAuthId=' + (oauthState.pendingAuthId ? oauthState.pendingAuthId.slice(0, 8) + '…' : 'none'));

    let tokenSet;
    try {
      tokenSet = await exchangeAuthorizationCode(config, code);
    } catch (err) {
      // Code exchange failed — most likely the authorization code was already used
      // by a prior request (e.g. speculative prefetch). If pendingAuth was set by
      // that prior request the user can still recover via the Refresh button.
      console.warn('[smartthings-controls-server] OAuth callback: code exchange failed (code may have been used by a prior request):', err instanceof Error ? err.message : err);
      const fallbackUrl = `${config.publicAppUrl}/auth-complete.html`;
      return redirect(response, fallbackUrl);
    }

    const session = await store.createSession(tokenSet);
    if (oauthState.pendingAuthId) {
      await store.setPendingAuth(oauthState.pendingAuthId, session.sessionId);
      console.log('[smartthings-controls-server] OAuth callback: pendingAuth set. pendingAuthId=' + oauthState.pendingAuthId.slice(0, 8) + '…');
    }
    // State successfully processed — delete it now to prevent reuse.
    await store.deleteOAuthState(state);

    const cookieOptions = getSessionCookieOptions(request);
    const returnToBase = normalizeReturnTo(oauthState.returnTo);
    // Append the session ID as a URL param so cross-origin webviews can pick it up
    // without relying on cross-origin cookies (e.g. Even simulator on localhost).
    const separator = returnToBase.includes('?') ? '&' : '?';
    const redirectTarget = `${returnToBase}${separator}_st=${encodeURIComponent(session.sessionId)}`;
    setSessionCookie(response, config.sessionCookieName, session.sessionId, cookieOptions);
    console.log('[smartthings-controls-server] OAuth callback: session created and redirect sent. sessionId=' + session.sessionId.slice(0, 8) + '…');
    return redirect(response, redirectTarget);
  } catch (err) {
    return sendServerError(response, err);
  }
}

export async function handleSmartAppWebhookRequest(request, response) {
  try {
    if (request.method === 'GET') {
      return json(response, 200, {
        ok: true,
        targetUrl: getSmartAppTargetUrl(request),
        message: 'SmartThings SmartApp webhook endpoint',
      });
    }

    if (request.method !== 'POST') return methodNotAllowed(response, ['GET', 'POST']);

    const body = await readJsonBody(request);
    const lifecycle = typeof body.lifecycle === 'string' ? body.lifecycle : '';
    const targetUrl = getSmartAppTargetUrl(request);

    console.log('[smartthings-controls-server] SmartApp lifecycle:', lifecycle, JSON.stringify(body));

    switch (lifecycle) {
      case 'CONFIRMATION':
        await acknowledgeSmartAppConfirmation(body);
        return json(response, 200, { targetUrl });
      case 'PING':
        return json(response, 200, {
          pingData: {
            challenge: body?.pingData?.challenge ?? '',
          },
        });
      case 'CONFIGURATION': {
        const phase = body?.configurationData?.phase;
        if (phase === 'INITIALIZE') {
          return json(response, 200, getSmartAppInitializeResponse());
        }
        if (phase === 'PAGE') {
          return json(response, 200, getSmartAppPageResponse(body?.configurationData?.pageId));
        }
        return json(response, 200, { configurationData: {} });
      }
      case 'INSTALL':
        return json(response, 200, { installData: {} });
      case 'UPDATE':
        return json(response, 200, { updateData: {} });
      case 'EVENT':
        return json(response, 200, { eventData: {} });
      case 'OAUTH_CALLBACK':
        return json(response, 200, { oAuthCallbackData: {} });
      case 'UNINSTALL':
        return json(response, 200, { uninstallData: {} });
      default:
        return json(response, 200, { status: 'ignored', lifecycle });
    }
  } catch (err) {
    return sendServerError(response, err);
  }
}
