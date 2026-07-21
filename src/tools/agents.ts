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
import { readOnlyTool, updateTool, writeTool } from './annotations.js';

export function registerAgentTools(server: McpServer, client: CovalApiClient) {
  server.registerTool(
    'list_agents',
    {
      ...readOnlyTool('List agents'),
      description:
        'List agents (AI systems to evaluate). Model types: VOICE, OUTBOUND_VOICE, SMS, WEBSOCKET, CHAT. Use agent_id when creating runs.',
      inputSchema: ListAgentsInputSchema.shape,
    },
    async (params) => {
      try {
        const result = await client.listAgents(params);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );

  server.registerTool(
    'get_agent',
    {
      ...readOnlyTool('Get agent'),
      description:
        'Get agent config: model_type, phone_number (voice), endpoint (websocket/chat), and display_name.',
      inputSchema: GetAgentInputSchema.shape,
    },
    async (params) => {
      try {
        const result = await client.getAgent(params.agent_id);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );

  server.registerTool(
    'create_agent',
    {
      ...writeTool('Create agent'),
      description:
        'Create a new agent configuration. Specify the model type (voice, chat, SMS, websocket) and connection details. API reference: https://docs.coval.dev/api-reference/agents/connect-an-agent',
      inputSchema: CreateAgentInputSchema.shape,
    },
    async (params) => {
      try {
        const result = await client.createAgent(params);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );

  server.registerTool(
    'update_agent',
    {
      ...updateTool('Update agent'),
      description:
        'Update an existing agent configuration. Only provided fields will be updated. API reference: https://docs.coval.dev/api-reference/agents/update-agent',
      inputSchema: UpdateAgentInputSchema.shape,
    },
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
