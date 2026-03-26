import { randomUUID } from 'node:crypto';

export function json(response, statusCode, body) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

export function redirect(response, location) {
  response.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store',
  });
  response.end();
}

export function notFound(response) {
  json(response, 404, { error: 'Not found' });
}

export function methodNotAllowed(response, allowedMethods) {
  response.writeHead(405, {
    Allow: allowedMethods.join(', '),
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify({ error: 'Method not allowed' }));
}

export function parseCookies(request) {
  const cookieHeader = request.headers.cookie ?? '';
  const cookies = {};
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) continue;
    const name = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

export function setSessionCookie(response, name, value, options = {}) {
  const secure = options.secure ?? false;
  // SameSite=None is required for cross-origin cookie delivery (Even webview / local simulator).
  // SameSite=None mandates Secure; fall back to Lax only for plain-HTTP contexts.
  const sameSite = secure ? 'None' : 'Lax';
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', `SameSite=${sameSite}`];
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`);
  if (secure) parts.push('Secure');
  response.setHeader('Set-Cookie', parts.join('; '));
}

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

/**
 * Returns the value to use for Access-Control-Allow-Origin, or null if the
 * origin is not permitted.  Allowed origins:
 *   - The configured publicAppUrl (Vercel production)
 *   - Any localhost / 127.0.0.1 origin (local development)
 *   - The string "null" emitted by packaged webviews (.ehpk / file://)
 */
export function getCorsOrigin(request, publicAppUrl) {
  const origin = request.headers.origin;
  if (!origin) return null;
  if (origin === 'null') return 'null'; // packaged Even G2 webview
  if (origin === publicAppUrl) return origin;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

/**
 * Appends CORS response headers when the request origin is permitted.
 * Call this before writing the status line so headers can still be set.
 */
export function applyCors(response, request, publicAppUrl) {
  const allowedOrigin = getCorsOrigin(request, publicAppUrl);
  if (!allowedOrigin) return;
  response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  response.setHeader('Access-Control-Allow-Credentials', 'true');
  response.setHeader('Vary', 'Origin');
}

/**
 * Handles an OPTIONS preflight request and returns true.
 * Returns false if the request is not OPTIONS (caller should continue normally).
 */
export function handlePreflightIfNeeded(response, request, publicAppUrl) {
  if (request.method !== 'OPTIONS') return false;
  const allowedOrigin = getCorsOrigin(request, publicAppUrl);
  if (allowedOrigin) {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    });
  } else {
    response.writeHead(403);
  }
  response.end();
  return true;
}

export function clearSessionCookie(response, name, options = {}) {
  setSessionCookie(response, name, '', { ...options, maxAgeSeconds: 0 });
}

export async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

export function makeOpaqueId() {
  return randomUUID();
}
