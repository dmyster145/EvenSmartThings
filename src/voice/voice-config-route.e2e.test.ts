import { describe, it, expect } from 'vitest';
import { handleVoiceConfigRequest } from '../../server/route-handlers.js';
import { parseVoiceConfig, defaultVoiceConfig } from './config';

// E2E — the real backend handler (no auth, public, cacheable). Verifies the
// served payload is exactly what the client's defensive parser accepts and
// equals the bundled fallback, and that the cache header is NOT no-store.
interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  setHeader(k: string, v: string): void;
  writeHead(status: number, headers?: Record<string, string>): void;
  end(chunk?: string): void;
}
function mockRes(): MockRes {
  const res: MockRes = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = String(v);
    },
    writeHead(status, headers) {
      this.statusCode = status;
      for (const [k, v] of Object.entries(headers ?? {})) this.headers[k.toLowerCase()] = String(v);
    },
    end(chunk) {
      if (chunk) this.body += chunk;
    },
  };
  return res;
}
const req = (method: string) =>
  ({ method, headers: {}, url: '/api/voice-config' }) as unknown as Parameters<
    typeof handleVoiceConfigRequest
  >[0];

describe('GET /api/voice-config handler', () => {
  it('returns 200 JSON the client parser accepts, equal to the bundled default', async () => {
    const res = mockRes();
    await handleVoiceConfigRequest(req('GET'), res as never);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    expect(res.headers['cache-control']).not.toContain('no-store');
    expect(parseVoiceConfig(res.body)).toEqual(defaultVoiceConfig);
  });

  it('rejects non-GET with 405', async () => {
    const res = mockRes();
    await handleVoiceConfigRequest(req('POST'), res as never);
    expect(res.statusCode).toBe(405);
  });
});
