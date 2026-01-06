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
    'List all configured agents. Use this to find agent IDs for creating runs. Can filter by model_type (voice, chat, SMS, etc.).',
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
    'Get detailed configuration for a specific agent. Shows model type, endpoint, prompt, associated metrics, and test sets.',
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
