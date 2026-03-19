import { handleSessionLogoutRequest } from '../../server/route-handlers.js';

export default async function handler(request, response) {
  return handleSessionLogoutRequest(request, response);
}
