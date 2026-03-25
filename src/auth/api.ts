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

type HttpError = Error & { status?: number };

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
  const response = await fetch('/api/session', {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  return parseJsonResponse<SessionStatus>(response);
}

export async function getSmartThingsAccessToken(): Promise<AccessTokenResponse> {
  const response = await fetch('/api/smartthings/access-token', {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  return parseJsonResponse<AccessTokenResponse>(response);
}

export async function disconnectSmartThings(): Promise<void> {
  const response = await fetch('/api/session/logout', {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  await parseJsonResponse(response);
}

async function executeSmartThingsRelayRequest<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/smartthings/execute', {
    method: 'POST',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
    keepalive: true,
    body: JSON.stringify(body),
  });
  return parseJsonResponse<T>(response);
}

export async function executeSceneViaServer(sceneId: string): Promise<SmartThingsRelayResponse> {
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
  return executeSmartThingsRelayRequest<SmartThingsRelayResponse>({
    kind: 'device',
    deviceId,
    capability,
    command,
    arguments: args,
  });
}

export async function executeBatchDeviceCommandsViaServer(
  commands: Array<{ deviceId: string; capability: string; command: string; arguments?: unknown[] }>
): Promise<{ results: SmartThingsBatchRelayResult[] }> {
  return executeSmartThingsRelayRequest<{ results: SmartThingsBatchRelayResult[] }>({
    kind: 'batch-device',
    commands,
  });
}

export function startSmartThingsConnect(returnTo?: string): void {
  const fallbackReturnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const nextReturnTo = returnTo || fallbackReturnTo || '/';
  window.location.assign(`/api/auth/smartthings/start?return_to=${encodeURIComponent(nextReturnTo)}`);
}
