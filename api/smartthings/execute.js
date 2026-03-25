import { handleSmartThingsExecuteRequest } from '../../server/route-handlers.js';

export default async function handler(request, response) {
  return handleSmartThingsExecuteRequest(request, response);
}
