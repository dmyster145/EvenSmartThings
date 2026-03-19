import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { makeOpaqueId } from './http-utils.js';

const EMPTY_STORE = {
  sessions: {},
  oauthStates: {},
};

async function loadStore(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      sessions: parsed.sessions ?? {},
      oauthStates: parsed.oauthStates ?? {},
    };
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return { ...EMPTY_STORE };
    }
    throw err;
  }
}

async function saveStore(filePath, store) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(store, null, 2), 'utf8');
}

function serializeRecord(value) {
  return JSON.stringify(value);
}

function parseRecord(rawValue) {
  if (!rawValue) return null;
  try {
    return JSON.parse(rawValue);
  } catch {
    return null;
  }
}

function getSessionKey(config, sessionId) {
  return `${config.redis.keyPrefix}:session:${sessionId}`;
}

function getOauthStateKey(config, stateId) {
  return `${config.redis.keyPrefix}:oauth-state:${stateId}`;
}

class FileSessionStore {
  constructor(config) {
    this.filePath = config.sessionFile;
  }

  async createOAuthState(returnTo) {
    const stateId = makeOpaqueId();
    const store = await loadStore(this.filePath);
    store.oauthStates[stateId] = {
      returnTo: returnTo || '/',
      createdAt: new Date().toISOString(),
    };
    await saveStore(this.filePath, store);
    return stateId;
  }

  async consumeOAuthState(stateId) {
    const store = await loadStore(this.filePath);
    const entry = store.oauthStates[stateId];
    if (!entry) return null;
    delete store.oauthStates[stateId];
    await saveStore(this.filePath, store);
    return entry;
  }

  async createSession(sessionData) {
    const sessionId = makeOpaqueId();
    const store = await loadStore(this.filePath);
    store.sessions[sessionId] = {
      sessionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...sessionData,
    };
    await saveStore(this.filePath, store);
    return store.sessions[sessionId];
  }

  async getSession(sessionId) {
    if (!sessionId) return null;
    const store = await loadStore(this.filePath);
    return store.sessions[sessionId] ?? null;
  }

  async putSession(session) {
    const store = await loadStore(this.filePath);
    store.sessions[session.sessionId] = {
      ...session,
      updatedAt: new Date().toISOString(),
    };
    await saveStore(this.filePath, store);
    return store.sessions[session.sessionId];
  }

  async deleteSession(sessionId) {
    if (!sessionId) return;
    const store = await loadStore(this.filePath);
    if (!store.sessions[sessionId]) return;
    delete store.sessions[sessionId];
    await saveStore(this.filePath, store);
  }
}

class UnsupportedSessionStore {
  constructor(message) {
    this.message = message;
  }

  async createOAuthState() {
    throw new Error(this.message);
  }

  async consumeOAuthState() {
    throw new Error(this.message);
  }

  async createSession() {
    throw new Error(this.message);
  }

  async getSession() {
    return null;
  }

  async putSession() {
    throw new Error(this.message);
  }

  async deleteSession() {
    return;
  }
}

class RedisSessionStore {
  constructor(config) {
    this.config = config;
  }

  async runCommand(...command) {
    const response = await fetch(this.config.redis.restUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.redis.restToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(command),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) {
      const message =
        typeof payload.error === 'string'
          ? payload.error
          : `Redis command failed with status ${response.status}`;
      throw new Error(message);
    }

    return payload.result;
  }

  async createOAuthState(returnTo) {
    const stateId = makeOpaqueId();
    const state = {
      returnTo: returnTo || '/',
      createdAt: new Date().toISOString(),
    };
    await this.runCommand(
      'SET',
      getOauthStateKey(this.config, stateId),
      serializeRecord(state),
      'EX',
      String(this.config.oauthStateTtlSeconds)
    );
    return stateId;
  }

  async consumeOAuthState(stateId) {
    if (!stateId) return null;
    const raw = await this.runCommand('GETDEL', getOauthStateKey(this.config, stateId));
    return parseRecord(raw);
  }

  async createSession(sessionData) {
    const sessionId = makeOpaqueId();
    const session = {
      sessionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ...sessionData,
    };
    await this.runCommand(
      'SET',
      getSessionKey(this.config, sessionId),
      serializeRecord(session),
      'EX',
      String(this.config.sessionTtlSeconds)
    );
    return session;
  }

  async getSession(sessionId) {
    if (!sessionId) return null;
    const raw = await this.runCommand('GET', getSessionKey(this.config, sessionId));
    return parseRecord(raw);
  }

  async putSession(session) {
    const nextSession = {
      ...session,
      updatedAt: new Date().toISOString(),
    };
    await this.runCommand(
      'SET',
      getSessionKey(this.config, session.sessionId),
      serializeRecord(nextSession),
      'EX',
      String(this.config.sessionTtlSeconds)
    );
    return nextSession;
  }

  async deleteSession(sessionId) {
    if (!sessionId) return;
    await this.runCommand('DEL', getSessionKey(this.config, sessionId));
  }
}

export function createSessionStore(config) {
  if (config.storageDriver === 'redis') {
    return new RedisSessionStore(config);
  }
  if (process.env.VERCEL) {
    return new UnsupportedSessionStore(
      'SmartThings session storage is not configured for Vercel. Add KV_REST_API_URL and KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.'
    );
  }
  return new FileSessionStore(config);
}
