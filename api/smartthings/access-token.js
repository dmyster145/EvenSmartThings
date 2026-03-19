import { handleAccessTokenRequest } from '../../server/route-handlers.js';

export default async function handler(request, response) {
  return handleAccessTokenRequest(request, response);
}
