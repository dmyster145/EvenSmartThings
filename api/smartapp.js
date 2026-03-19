import { handleSmartAppWebhookRequest } from '../server/route-handlers.js';

export default async function handler(request, response) {
  return handleSmartAppWebhookRequest(request, response);
}
