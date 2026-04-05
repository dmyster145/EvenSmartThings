import { handleAuthPatRequest } from '../../../server/route-handlers.js';

export default async function handler(request, response) {
  return handleAuthPatRequest(request, response);
}
