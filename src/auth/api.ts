export type SessionStatus = {
  authenticated: boolean;
  configured: boolean;
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

declare const __API_BASE_URL__: string;
const API_BASE: string =
  typeof __API_BASE_URL__ !== 'undefined' && __API_BASE_URL__ ? __API_BASE_URL__ : '';

const SESSION_TOKEN_STORAGE_KEY = 'smartthings_controls_bearer_session';

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
}

async function executeSmartThingsRelayRequest<T>(body: Record<string, unknown>): Promise<T> {
  const envelope = createRelayEnvelope(body, 'fetch');
  const summary = summarizeRelayPayload(envelope.body);
  emitSmartThingsDebug(
    `Relay fetch dispatch: requestId=${envelope.requestId} ${summary} visibility=${getVisibilityState()}`
  );
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
    body: JSON.stringify(envelope.body),
  });
  const payload = await response.json().catch(() => ({}));
  emitSmartThingsDebug(
    `Relay fetch response: requestId=${typeof (payload as { requestId?: unknown }).requestId === 'string' ? String((payload as { requestId: string }).requestId) : envelope.requestId} ${summary} status=${response.status} ok=${response.ok}`
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
}

function shouldUseBackgroundBeacon(): boolean {
  return typeof document !== 'undefined' && document.visibilityState !== 'visible' && typeof navigator.sendBeacon === 'function';
}

function sendSmartThingsBeacon(body: Record<string, unknown>): boolean {
  if (!shouldUseBackgroundBeacon()) return false;
  const envelope = createRelayEnvelope(body, 'beacon');
  const summary = summarizeRelayPayload(envelope.body);
  const payload = new Blob([JSON.stringify(envelope.body)], { type: 'application/json' });
  const accepted = navigator.sendBeacon(`${API_BASE}/api/smartthings/execute`, payload);
  emitSmartThingsDebug(
    `Relay beacon ${accepted ? 'accepted' : 'rejected'}: requestId=${envelope.requestId} ${summary} visibility=${getVisibilityState()}`,
    !accepted
  );
  return accepted;
}

export async function executeSceneViaServer(sceneId: string): Promise<SmartThingsRelayResponse> {
  if (sendSmartThingsBeacon({ kind: 'scene', sceneId })) {
    return { status: 'success' };
  }
  return executeSmartThingsRelayRequest<SmartThingsRelayResponse>({
    kind: 'scene',
    sceneId,
  });
}

export async function executeDeviceCommandViaServer(
  deviceId: string,
  capability: string,
  command: string,
  args: unknown[] = []
): Promise<SmartThingsRelayResponse> {
  if (
    sendSmartThingsBeacon({
      kind: 'device',
      deviceId,
      capability,
      command,
      arguments: args,
    })
  ) {
    return { status: 'success', results: [] };
  }
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
  if (sendSmartThingsBeacon({ kind: 'batch-device', commands })) {
    return {
      results: commands.map((entry) => ({
        deviceId: entry.deviceId,
        ok: true,
        status: 'queued',
        results: [],
      })),
    };
  }
  return executeSmartThingsRelayRequest<SmartThingsBatchRelayResponse>({
    kind: 'batch-device',
    commands,
  });
}

export function startSmartThingsConnect(returnTo?: string): void {
  // Use the full origin URL so the OAuth redirect comes back to this exact origin
  // (important when running from localhost in the Even simulator).
  const fallbackReturnTo = window.location.href.split('#')[0]; // strip hash
  const nextReturnTo = returnTo || fallbackReturnTo || '/';
  window.location.assign(`${API_BASE}/api/auth/smartthings/start?return_to=${encodeURIComponent(nextReturnTo)}`);
}
