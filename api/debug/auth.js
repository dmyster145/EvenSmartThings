import { handleAuthDebugRequest } from '../../server/route-handlers.js';

export default async function handler(request, response) {
  return handleAuthDebugRequest(request, response);
}
