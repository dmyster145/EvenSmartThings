import { handleVoiceConfigRequest } from '../server/route-handlers.js';

export default async function handler(request, response) {
  return handleVoiceConfigRequest(request, response);
}
