import { handleAuthPendingRequest } from '../../server/route-handlers.js';

export default async function handler(request, response) {
  return handleAuthPendingRequest(request, response);
}
