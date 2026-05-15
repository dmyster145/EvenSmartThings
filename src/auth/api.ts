export type SessionStatus = {
  authenticated: boolean;
  configured: boolean;
  /** True when a session existed but the refresh token was rejected (e.g. expired after 30 days inactivity). */
  sessionExpired?: boolean;
  redirectUri?: string;
  scopes?: string;
  authorizePath?: string;
  session?: {
    connectedAt?: string;
    expiresAt?: string;
    scope?: string;
    tokenType?: string;
  };
};

export type AccessTokenResponse = {
  accessToken: string;
  expiresAt?: string;
  scope?: string;
  tokenType?: string;
};

export type SmartThingsRelayResponse = {
  requestId?: string;
  status?: string;
  results?: Array<{ status?: string }>;
};

export type SmartThingsBatchRelayResult = {
  deviceId: string;
  ok: boolean;
  status?: string;
  results?: Array<{ status?: string }>;
  error?: string;
};

export type SmartThingsBatchRelayResponse = {
  requestId?: string;
  results: SmartThingsBatchRelayResult[];
};

export type SmartThingsSceneListResponse = {
  requestId?: string;
  items?: Array<{ sceneId?: string; sceneName?: string }>;
};

declare const __API_BASE_URL__: string;
const API_BASE: string =
  typeof __API_BASE_URL__ !== 'undefined' && __API_BASE_URL__ ? __API_BASE_URL__ : '';

const SESSION_TOKEN_STORAGE_KEY = 'smartthings_controls_bearer_session';
const PENDING_AUTH_STORAGE_KEY = 'smartthings_controls_pending_auth';
const SESSION_CACHE_KEY = 'smartthings_controls_session_cache';
const SESSION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type SessionCache = { status: SessionStatus; cachedAt: number };

export function readCachedSessionStatus(): SessionStatus | null {
  try {
    const raw = localStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw) as SessionCache;
    if (!cache.status?.authenticated) return null;
    if (Date.now() - cache.cachedAt > SESSION_CACHE_TTL_MS) return null;
    return cache.status;
  } catch {
    return null;
  }
}

export function writeCachedSessionStatus(status: SessionStatus): void {
  try {
    const cache: SessionCache = { status, cachedAt: Date.now() };
    localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore
  }
}

export function clearCachedSessionStatus(): void {
  try {
    localStorage.removeItem(SESSION_CACHE_KEY);
  } catch {
    // ignore
  }
}

export function readStoredSessionToken(): string | null {
  try {
    return localStorage.getItem(SESSION_TOKEN_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function writeStoredSessionToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
    } else {
      localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}

/**
 * Reads the `_st` session token from the current URL's query params,
 * stores it in localStorage, and removes it from the URL (replaceState).
 * Call once at app startup.
 */
export function consumeSessionTokenFromUrl(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('_st');
    if (!token) return null;
    params.delete('_st');
    const newSearch = params.toString();
    const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '') + window.location.hash;
    window.history.replaceState(null, '', newUrl);
    writeStoredSessionToken(token);
    return token;
  } catch {
    return null;
  }
}

function getSessionAuthHeaders(): Record<string, string> {
  const token = readStoredSessionToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export const SMARTTHINGS_DEBUG_EVENT = 'smartthings-controls:debug';

type DeviceCommandPayload = {
  deviceId: string;
  capability: string;
  command: string;
  arguments?: unknown[];
};

type HttpError = Error & { status?: number };

function emitSmartThingsDebug(message: string, reveal = false): void {
  console.log(`[SmartThingsControls][Relay] ${message}`);
  if (typeof window.dispatchEvent !== 'function' || typeof CustomEvent !== 'function') return;
  window.dispatchEvent(
    new CustomEvent(SMARTTHINGS_DEBUG_EVENT, {
      detail: { message, reveal },
    })
  );
}

function getVisibilityState(): string {
  return typeof document !== 'undefined' ? document.visibilityState : 'unknown';
}

function summarizeRelayPayload(body: Record<string, unknown>): string {
  const kind = typeof body.kind === 'string' ? body.kind : 'unknown';
  if (kind === 'scene') {
    const sceneId = typeof body.sceneId === 'string' ? body.sceneId : 'unknown';
    return `kind=scene sceneId=${sceneId}`;
  }
  if (kind === 'device') {
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId : 'unknown';
    const capability = typeof body.capability === 'string' ? body.capability : 'unknown';
    const command = typeof body.command === 'string' ? body.command : 'unknown';
    return `kind=device deviceId=${deviceId} capability=${capability} command=${command}`;
  }
  if (kind === 'batch-device') {
    const commands = Array.isArray(body.commands) ? body.commands : [];
    const first = commands[0] as { capability?: unknown; command?: unknown } | undefined;
    const capability = typeof first?.capability === 'string' ? first.capability : 'unknown';
    const command = typeof first?.command === 'string' ? first.command : 'unknown';
    return `kind=batch-device count=${commands.length} capability=${capability} command=${command}`;
  }
  return `kind=${kind}`;
}

function makeRelayRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `relay-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function createRelayEnvelope(
  body: Record<string, unknown>,
  transport: 'fetch' | 'beacon'
): { requestId: string; body: Record<string, unknown> } {
  const requestId = makeRelayRequestId();
  return {
    requestId,
    body: {
      ...body,
      requestId,
      clientTransport: transport,
      clientVisibility: getVisibilityState(),
      clientIssuedAt: new Date().toISOString(),
    },
  };
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof (payload as { error?: unknown }).error === 'string'
        ? String((payload as { error: string }).error)
        : `Request failed with status ${response.status}`;
    const err = new Error(message) as HttpError;
    err.status = response.status;
    throw err;
  }
  return payload as T;
}

export async function getSessionStatus(): Promise<SessionStatus> {
  const response = await fetch(`${API_BASE}/api/session`, {
    credentials: 'include',
    headers: { Accept: 'application/json', ...getSessionAuthHeaders() },
  });
  return parseJsonResponse<SessionStatus>(response);
}

export async function getSmartThingsAccessToken(): Promise<AccessTokenResponse> {
  const response = await fetch(`${API_BASE}/api/smartthings/access-token`, {
    credentials: 'include',
    headers: { Accept: 'application/json', ...getSessionAuthHeaders() },
  });
  return parseJsonResponse<AccessTokenResponse>(response);
}

export async function disconnectSmartThings(): Promise<void> {
  const response = await fetch(`${API_BASE}/api/session/logout`, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json', ...getSessionAuthHeaders() },
  });
  await parseJsonResponse(response);
  writeStoredSessionToken(null);
  clearCachedSessionStatus();
}

// Per-request timeout for the relay fetch. Vercel function cold starts can add
// 1–3s of latency; 8s gives enough headroom while still failing fast on a stuck
// connection. On timeout or transient failure (network error, 502/503/504) we
// retry once before surfacing the error to the caller.
const RELAY_REQUEST_TIMEOUT_MS = 8000;
const RELAY_RETRY_DELAY_MS = 200;

function isTransientStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

async function fetchRelayOnce<T>(
  envelope: { requestId: string; body: Record<string, unknown> },
  summary: string,
  attempt: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RELAY_REQUEST_TIMEOUT_MS);
  emitSmartThingsDebug(
    `Relay fetch dispatch: requestId=${envelope.requestId} attempt=${attempt} ${summary} visibility=${getVisibilityState()}`
  );
  try {
    const response = await fetch(`${API_BASE}/api/smartthings/execute`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...getSessionAuthHeaders(),
      },
      cache: 'no-store',
      keepalive: true,
      signal: controller.signal,
      body: JSON.stringify(envelope.body),
    });
    const payload = await response.json().catch(() => ({}));
    emitSmartThingsDebug(
      `Relay fetch response: requestId=${typeof (payload as { requestId?: unknown }).requestId === 'string' ? String((payload as { requestId: string }).requestId) : envelope.requestId} attempt=${attempt} ${summary} status=${response.status} ok=${response.ok}`
        + (response.ok ? '' : ` error=${typeof (payload as { error?: unknown }).error === 'string' ? String((payload as { error: string }).error) : 'unknown'}`),
      !response.ok
    );
    if (!response.ok) {
      const message =
        typeof (payload as { error?: unknown }).error === 'string'
          ? String((payload as { error: string }).error)
          : `Request failed with status ${response.status}`;
      const err = new Error(message) as HttpError;
      err.status = response.status;
      throw err;
    }
    return payload as T;
  } finally {
    clearTimeout(timer);
  }
}

async function executeSmartThingsRelayRequest<T>(body: Record<string, unknown>): Promise<T> {
  const envelope = createRelayEnvelope(body, 'fetch');
  const summary = summarizeRelayPayload(envelope.body);
  try {
    return await fetchRelayOnce<T>(envelope, summary, 1);
  } catch (err) {
    const httpStatus = (err as HttpError | undefined)?.status;
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    const isTransientHttp = typeof httpStatus === 'number' && isTransientStatus(httpStatus);
    const isNetworkError = err instanceof TypeError; // fetch network failure
    if (!isAbort && !isTransientHttp && !isNetworkError) {
      throw err;
    }
    emitSmartThingsDebug(
      `Relay fetch retry: requestId=${envelope.requestId} reason=${isAbort ? 'timeout' : isTransientHttp ? `http-${httpStatus}` : 'network'} ${summary}`,
      true,
    );
    await new Promise((r) => setTimeout(r, RELAY_RETRY_DELAY_MS));
    return await fetchRelayOnce<T>(envelope, summary, 2);
  }
}

// Note: previously dispatched commands via navigator.sendBeacon when the page
// was hidden, but that returns "success" on queue acceptance — not delivery.
// When the beacon never transmitted (transient network, suspended radio), the
// glasses showed a success icon while the device didn't move, forcing the user
// to re-tap. We now always use fetch + keepalive: true, which survives
// backgrounding on modern Safari and reports the real status.

export async function executeSceneViaServer(sceneId: string): Promise<SmartThingsRelayResponse> {
  return executeSmartThingsRelayRequest<SmartThingsRelayResponse>({
    kind: 'scene',
    sceneId,
  });
}

/**
 * List scenes through the server relay instead of calling api.smartthings.com
 * directly from the WebView. The direct browser call fails with a network-layer
 * error for some accounts (no HTTP response — CORS/redirect/reset) while
 * rooms/devices/locations succeed; the server proxy has no browser network
 * constraints and follows pagination server-side.
 */
export async function listScenesViaServer(locationId?: string): Promise<SmartThingsSceneListResponse> {
  return executeSmartThingsRelayRequest<SmartThingsSceneListResponse>({
    kind: 'list-scenes',
    ...(locationId ? { locationId } : {}),
  });
}

export async function executeDeviceCommandViaServer(
  deviceId: string,
  capability: string,
  command: string,
  args: unknown[] = []
): Promise<SmartThingsRelayResponse> {
  return executeSmartThingsRelayRequest<SmartThingsRelayResponse>({
    kind: 'device',
    deviceId,
    capability,
    command,
    arguments: args,
  });
}

export async function executeBatchDeviceCommandsViaServer(
  commands: DeviceCommandPayload[]
): Promise<SmartThingsBatchRelayResponse> {
  return executeSmartThingsRelayRequest<SmartThingsBatchRelayResponse>({
    kind: 'batch-device',
    commands,
  });
}

function generatePendingAuthId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `pa-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

/**
 * Generate a pending auth ID, write it to localStorage, and return it.
 * Call this before startSmartThingsConnect so the caller can also persist
 * the ID to bridge storage before the WebView navigates away.
 */
export function preparePendingAuth(): string {
  const pendingAuthId = generatePendingAuthId();
  try {
    localStorage.setItem(PENDING_AUTH_STORAGE_KEY, pendingAuthId);
  } catch {
    // ignore
  }
  return pendingAuthId;
}

/**
 * Build the OAuth start URL for a cross-device connect flow (e.g. open on Mac/PC).
 * The return_to points to auth-complete.html on Vercel (no app_url) so that the
 * session is delivered via the pending auth poll rather than a direct redirect.
 */
export function buildCrossDeviceConnectUrl(pendingAuthId: string): string {
  const returnTo = `${API_BASE}/auth-complete.html`;
  return `${API_BASE}/api/auth/smartthings/start?return_to=${encodeURIComponent(returnTo)}&pending_auth_id=${encodeURIComponent(pendingAuthId)}`;
}

export function startSmartThingsConnect(returnTo?: string, pendingAuthId?: string): void {
  // Use the full origin URL so the OAuth redirect comes back to this exact origin
  // (important when running from localhost in the Even simulator).
  // On a real device the WebView may serve from a localhost port that Safari
  // cannot reach, so fall back to the Vercel URL as the return_to destination.
  // The pending auth mechanism handles session recovery in Either case.
  const currentHref = window.location.href.split('#')[0] ?? '';
  const isLocalhostOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(currentHref);
  const apiBase: string = API_BASE ?? '';
  // When an external API base is configured, the ehpk files are served locally
  // (localhost/127.0.0.1) but API calls go to Vercel. Safari cannot reach the
  // localhost address after OAuth, so use auth-complete.html on Vercel instead.
  // Dev/simulator: isLocalhostOrigin AND no external base — return_to stays at
  // the local address so the WebView comes back to the SPA after OAuth.
  const hasExternalApiBase = apiBase.startsWith('https://') ||
    (apiBase.startsWith('http://') && !/localhost|127\.0\.0\.1/.test(apiBase));
  const appUrlParam = currentHref ? `?app_url=${encodeURIComponent(currentHref)}` : '';
  const nonLocalReturnTo = apiBase ? `${apiBase}/auth-complete.html${appUrlParam}` : `/auth-complete.html${appUrlParam}`;
  const safeReturnTo = returnTo || (isLocalhostOrigin && !hasExternalApiBase ? currentHref : nonLocalReturnTo);
  // Use a pre-generated pending auth ID (so the caller can persist it to bridge
  // storage before navigation), or generate one now as a fallback.
  const authId = pendingAuthId ?? preparePendingAuth();
  window.location.assign(
    `${API_BASE}/api/auth/smartthings/start?return_to=${encodeURIComponent(safeReturnTo)}&pending_auth_id=${encodeURIComponent(authId)}`
  );
}

/**
 * Check if there is a pending OAuth flow that completed outside this WebView.
 * If so, consume the session token and return it. Called on app resume.
 */
export async function checkPendingAuth(): Promise<string | null> {
  let pendingId: string | null = null;
  try {
    pendingId = localStorage.getItem(PENDING_AUTH_STORAGE_KEY);
  } catch (err) {
    emitSmartThingsDebug(`[PendingAuth] localStorage read failed: ${err instanceof Error ? err.message : String(err)}`, true);
    return null;
  }
  if (!pendingId) {
    emitSmartThingsDebug('[PendingAuth] No pending auth ID in localStorage.');
    return null;
  }
  emitSmartThingsDebug(`[PendingAuth] Found pending ID: ${pendingId.slice(0, 8)}… Polling server.`);

  try {
    const url = `${API_BASE}/api/auth/pending?id=${encodeURIComponent(pendingId)}`;
    emitSmartThingsDebug(`[PendingAuth] Fetching: ${url}`);
    const response = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    emitSmartThingsDebug(`[PendingAuth] Response status: ${response.status}`);
    if (!response.ok) {
      emitSmartThingsDebug(`[PendingAuth] Non-OK response: ${response.status}`, true);
      return null;
    }
    const data = (await response.json()) as { completed?: boolean; sessionId?: string };
    emitSmartThingsDebug(`[PendingAuth] Payload: completed=${data.completed} hasSessionId=${!!data.sessionId}`);
    if (!data.completed || !data.sessionId) {
      emitSmartThingsDebug('[PendingAuth] Not yet completed or missing sessionId.');
      return null;
    }

    // Auth completed externally — store the session token
    writeStoredSessionToken(data.sessionId);
    try {
      localStorage.removeItem(PENDING_AUTH_STORAGE_KEY);
    } catch {
      // ignore
    }
    emitSmartThingsDebug('[PendingAuth] Session token stored from external OAuth flow.');
    return data.sessionId;
  } catch (err) {
    emitSmartThingsDebug(`[PendingAuth] Fetch error: ${err instanceof Error ? err.message : String(err)}`, true);
    return null;
  }
}

/** Clear any pending auth marker (e.g. after normal _st consumption). */
export function clearPendingAuth(): void {
  try {
    localStorage.removeItem(PENDING_AUTH_STORAGE_KEY);
  } catch {
    // ignore
  }
}
