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
  const summary = summarizeRelayPayload(body);
  emitSmartThingsDebug(`Relay fetch dispatch: ${summary} visibility=${getVisibilityState()}`);
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
  const payload = await response.json().catch(() => ({}));
  emitSmartThingsDebug(
    `Relay fetch response: ${summary} status=${response.status} ok=${response.ok}`
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
  const summary = summarizeRelayPayload(body);
  const payload = new Blob([JSON.stringify(body)], { type: 'application/json' });
  const accepted = navigator.sendBeacon('/api/smartthings/execute', payload);
  emitSmartThingsDebug(
    `Relay beacon ${accepted ? 'accepted' : 'rejected'}: ${summary} visibility=${getVisibilityState()}`,
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
): Promise<{ results: SmartThingsBatchRelayResult[] }> {
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
