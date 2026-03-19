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

export function startSmartThingsConnect(returnTo?: string): void {
  const fallbackReturnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const nextReturnTo = returnTo || fallbackReturnTo || '/';
  window.location.assign(`/api/auth/smartthings/start?return_to=${encodeURIComponent(nextReturnTo)}`);
}
