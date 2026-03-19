import { handleAuthCallbackRequest } from '../../../server/route-handlers.js';

export default async function handler(request, response) {
  return handleAuthCallbackRequest(request, response);
}
