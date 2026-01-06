import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../client.js';
import { ListPersonasInputSchema, GetPersonaInputSchema } from '../schemas/index.js';
import { createSuccessResponse } from '../utils/response.js';
import { handleApiError } from '../utils/errors.js';

export function registerPersonaTools(server: McpServer, client: CovalApiClient) {
  server.tool(
    'list_personas',
    'List available simulated personas. Personas are required for creating runs - they define how the simulated user behaves.',
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
    'Get detailed information about a persona. Shows voice settings, language, background sound, and behavior configuration.',
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
