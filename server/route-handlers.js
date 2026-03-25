import { URL } from 'node:url';
import {
  clearSessionCookie,
  json,
  makeOpaqueId,
  methodNotAllowed,
  parseCookies,
  readJsonBody,
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

function shouldTouchSession(session) {
  const updatedAtMs = Date.parse(session?.updatedAt ?? session?.createdAt ?? '');
  if (Number.isNaN(updatedAtMs)) return true;
  return updatedAtMs <= Date.now() - config.rollingSessionTouchIntervalSeconds * 1000;
}

function normalizeReturnToPath(value) {
  if (typeof value !== 'string' || !value) return '/';
  if (!value.startsWith('/')) return '/';
  if (value.startsWith('//')) return '/';
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
        name: 'SmartThings Controls',
        description: 'SmartThings Controls for Even Realities G2 glasses',
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
        name: 'SmartThings Controls',
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

async function getAuthenticatedSession(request) {
  const cookies = parseCookies(request);
  const sessionId = cookies[config.sessionCookieName];
  if (!sessionId) return null;
  let session = await store.getSession(sessionId);
  if (!session) return null;
  session = await ensureFreshSession(config, store, session);
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

async function smartThingsApiRequest(session, path, options = {}) {
  const response = await fetch(`${SMARTTHINGS_API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${session.accessToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
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
    if (request.method !== 'POST') return methodNotAllowed(response, ['POST']);
    const session = await getAuthenticatedSession(request);
    if (!session) {
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

    logRelay('invalid', relayContext, 'reason=unsupported-kind');
    return json(response, 400, { requestId: relayContext.requestId, error: 'Unsupported command kind' });
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
