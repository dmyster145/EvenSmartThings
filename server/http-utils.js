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
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`);
  if (options.secure) parts.push('Secure');
  response.setHeader('Set-Cookie', parts.join('; '));
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
