import { handleAuthStartRequest } from '../../../server/route-handlers.js';

export default async function handler(request, response) {
  return handleAuthStartRequest(request, response);
}
