import { resolve } from 'node:path';

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function firstDefined(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

const defaultPublicAppUrl = 'http://127.0.0.1:5173';
const publicAppUrl = trimTrailingSlash(
  firstDefined(process.env.SMARTTHINGS_CONTROLS_PUBLIC_APP_URL, defaultPublicAppUrl)
);

export function getServerConfig() {
  const port = parsePositiveInteger(firstDefined(process.env.SMARTTHINGS_CONTROLS_SERVER_PORT), 8787);
  const host = firstDefined(process.env.SMARTTHINGS_CONTROLS_SERVER_HOST, '127.0.0.1');
  const smartThingsClientId = (process.env.SMARTTHINGS_CLIENT_ID ?? '').trim();
  const smartThingsClientSecret = (process.env.SMARTTHINGS_CLIENT_SECRET ?? '').trim();
  const smartThingsScopes = (process.env.SMARTTHINGS_SCOPES ?? 'r:devices:* x:devices:* r:locations:* r:scenes:* x:scenes:*').trim();
  const redirectUri = (process.env.SMARTTHINGS_REDIRECT_URI ?? `${publicAppUrl}/api/auth/smartthings/callback`).trim();
  const redisRestUrl = trimTrailingSlash(
    firstDefined(process.env.KV_REST_API_URL, process.env.UPSTASH_REDIS_REST_URL)
  );
  const redisRestToken = firstDefined(process.env.KV_REST_API_TOKEN, process.env.UPSTASH_REDIS_REST_TOKEN);
  const sessionTtlSeconds = parsePositiveInteger(
    firstDefined(process.env.SMARTTHINGS_CONTROLS_SESSION_TTL_SECONDS),
    60 * 60 * 24 * 30
  );
  const oauthStateTtlSeconds = parsePositiveInteger(
    firstDefined(process.env.SMARTTHINGS_CONTROLS_OAUTH_STATE_TTL_SECONDS),
    60 * 10
  );
  const storagePrefix = firstDefined(process.env.SMARTTHINGS_CONTROLS_STORAGE_PREFIX, 'smartthings-controls')
    .replace(/:+$/, '');

  return {
    port,
    host,
    publicAppUrl,
    apiOrigin: trimTrailingSlash(
      firstDefined(process.env.SMARTTHINGS_CONTROLS_API_ORIGIN, `http://${host}:${port}`)
    ),
    sessionCookieName: firstDefined(
      process.env.SMARTTHINGS_CONTROLS_SESSION_COOKIE,
      'smartthings_controls_session'
    ),
    sessionFile: resolve(
      process.cwd(),
      firstDefined(process.env.SMARTTHINGS_CONTROLS_SESSION_FILE, 'server/data/sessions.json')
    ),
    sessionTtlSeconds,
    oauthStateTtlSeconds,
    storageDriver: redisRestUrl && redisRestToken ? 'redis' : 'file',
    redis: {
      restUrl: redisRestUrl,
      restToken: redisRestToken,
      keyPrefix: storagePrefix,
    },
    smartThings: {
      authorizeUrl: 'https://api.smartthings.com/oauth/authorize',
      tokenUrl: 'https://api.smartthings.com/oauth/token',
      clientId: smartThingsClientId,
      clientSecret: smartThingsClientSecret,
      scopes: smartThingsScopes,
      redirectUri,
    },
  };
}

export function isSmartThingsConfigured(config) {
  return Boolean(
    config.smartThings.clientId &&
    config.smartThings.clientSecret &&
    config.smartThings.redirectUri &&
    config.smartThings.scopes
  );
}
