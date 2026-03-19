import { handleSessionRequest } from '../server/route-handlers.js';

export default async function handler(request, response) {
  return handleSessionRequest(request, response);
}
