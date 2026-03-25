import { createServer } from 'node:http';
import { URL } from 'node:url';
import { getServerConfig } from './config.js';
import { json } from './http-utils.js';
import {
  handleAccessTokenRequest,
  handleAuthCallbackRequest,
  handleAuthStartRequest,
  handleHealthRequest,
  handleSessionLogoutRequest,
  handleSessionRequest,
  handleSmartThingsExecuteRequest,
  handleSmartAppWebhookRequest,
} from './route-handlers.js';

const config = getServerConfig();

const routeHandlers = new Map([
  ['/api/health', handleHealthRequest],
  ['/api/session', handleSessionRequest],
  ['/api/session/logout', handleSessionLogoutRequest],
  ['/api/smartthings/access-token', handleAccessTokenRequest],
  ['/api/smartthings/execute', handleSmartThingsExecuteRequest],
  ['/api/auth/smartthings/start', handleAuthStartRequest],
  ['/api/auth/smartthings/callback', handleAuthCallbackRequest],
  ['/api/smartapp', handleSmartAppWebhookRequest],
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', config.publicAppUrl);
    const handler = routeHandlers.get(url.pathname);
    if (!handler) {
      return json(response, 404, { error: 'Not found' });
    }
    return handler(request, response);
  } catch (err) {
    console.error('[smartthings-controls-server] request failed:', err);
    return json(response, 500, {
      error: err instanceof Error ? err.message : 'Unknown server error',
    });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`[smartthings-controls-server] listening on ${config.host}:${config.port}`);
});
