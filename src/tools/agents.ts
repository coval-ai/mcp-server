import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../client.js';
import {
  ListAgentsInputSchema,
  GetAgentInputSchema,
  CreateAgentInputSchema,
  UpdateAgentInputSchema,
} from '../schemas/index.js';
import { createSuccessResponse } from '../utils/response.js';
import { handleApiError } from '../utils/errors.js';

export function registerAgentTools(server: McpServer, client: CovalApiClient) {
  server.tool(
    'list_agents',
    'List agents (AI systems to evaluate). Model types: VOICE, OUTBOUND_VOICE, SMS, WEBSOCKET, CHAT. Use agent_id when creating runs.',
    ListAgentsInputSchema.shape,
    async (params) => {
      try {
        const result = await client.listAgents(params);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );

  server.tool(
    'get_agent',
    'Get agent config: model_type, phone_number (voice), endpoint (websocket/chat), and display_name.',
    GetAgentInputSchema.shape,
    async (params) => {
      try {
        const result = await client.getAgent(params.agent_id);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );

  server.tool(
    'create_agent',
    'Create a new agent configuration. Specify the model type (voice, chat, SMS, websocket) and connection details.',
    CreateAgentInputSchema.shape,
    async (params) => {
      try {
        const result = await client.createAgent(params);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );

  server.tool(
    'update_agent',
    'Update an existing agent configuration. Only provided fields will be updated.',
    UpdateAgentInputSchema.shape,
    async (params) => {
      try {
        const { agent_id, ...updateData } = params;
        const result = await client.updateAgent(agent_id, updateData);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );
}
