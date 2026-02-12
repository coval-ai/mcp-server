import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../client.js';
import { ListPersonasInputSchema, GetPersonaInputSchema } from '../schemas/index.js';
import { createSuccessResponse } from '../utils/response.js';
import { handleApiError } from '../utils/errors.js';

export function registerPersonaTools(server: McpServer, client: CovalApiClient) {
  server.tool(
    'list_personas',
    'List personas (simulated users). Each has voice_name, language_code, background_sound (off/office/crowd/airport/etc), and behavior prompt. Required for runs.',
    ListPersonasInputSchema.shape,
    async (params) => {
      try {
        const result = await client.listPersonas(params);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );

  server.tool(
    'get_persona',
    'Get persona details: voice_name, language_code (BCP-47), background_sound, persona_prompt (behavior), wait_seconds, conversation_initiation (speak_first/wait_for_user).',
    GetPersonaInputSchema.shape,
    async (params) => {
      try {
        const result = await client.getPersona(params.persona_id);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );
}
