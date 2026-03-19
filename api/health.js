import { handleHealthRequest } from '../server/route-handlers.js';

export default async function handler(request, response) {
  return handleHealthRequest(request, response);
}
