import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../client.js';
import { ListPersonasInputSchema, GetPersonaInputSchema } from '../schemas/index.js';
import { createSuccessResponse } from '../utils/response.js';
import { handleApiError } from '../utils/errors.js';
import { readOnlyTool } from './annotations.js';

export function registerPersonaTools(server: McpServer, client: CovalApiClient) {
  server.registerTool(
    'list_personas',
    {
      ...readOnlyTool('List personas'),
      description:
        'List personas (simulated users). Each has voice_name, language_code, background_sound, and a behavior prompt.',
      inputSchema: ListPersonasInputSchema.shape,
    },
    async (params) => {
      try {
        const result = await client.listPersonas(params);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );

  server.registerTool(
    'get_persona',
    {
      ...readOnlyTool('Get persona'),
      description:
        'Get persona details: voice_name, language_code (BCP-47), background_sound, persona_prompt (behavior), wait_seconds, conversation_initiation (speak_first/wait_for_user).',
      inputSchema: GetPersonaInputSchema.shape,
    },
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
