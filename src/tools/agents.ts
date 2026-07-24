import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { CovalApiClient } from '../client.js';
import {
  ListAgentsInputSchema,
  GetAgentInputSchema,
  CreateAgentInputSchema,
  UpdateAgentInputSchema,
} from '../schemas/index.js';
import { createErrorResponse, createSuccessResponse } from '../utils/response.js';
import { handleApiError } from '../utils/errors.js';
import {
  createTool,
  readOnlyTool,
  updateTool,
  type ToolAnnotationProfile,
} from './annotations.js';

const REQUIRED_STRING_FIELDS = ['id', 'display_name', 'model_type'] as const;
const SAFE_NULLABLE_STRING_FIELDS = ['phone_number', 'language'] as const;
const REQUIRED_STRING_ARRAY_FIELDS = [
  'metric_ids',
  'test_set_ids',
  'knowledge_base_ids',
] as const;
const INVALID_API_RESPONSE_MESSAGE = 'The Coval API returned an invalid response.';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function hasOwn(source: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, field);
}

function projectAgent(value: unknown): Record<string, unknown> | undefined {
  const source = asRecord(value);
  if (!source) return undefined;

  const projected: Record<string, unknown> = {};
  for (const field of REQUIRED_STRING_FIELDS) {
    const fieldValue = source[field];
    if (typeof fieldValue !== 'string' || fieldValue.trim().length === 0) return undefined;
    projected[field] = fieldValue;
  }
  for (const field of SAFE_NULLABLE_STRING_FIELDS) {
    if (!hasOwn(source, field)) continue;
    const fieldValue = source[field];
    if (typeof fieldValue !== 'string' && fieldValue !== null) return undefined;
    projected[field] = fieldValue;
  }

  projected.endpoint_configured =
    typeof source.endpoint === 'string' && source.endpoint.trim().length > 0;

  for (const field of REQUIRED_STRING_ARRAY_FIELDS) {
    const fieldValue = source[field];
    if (!Array.isArray(fieldValue) || !fieldValue.every((item) => typeof item === 'string')) {
      return undefined;
    }
    projected[field] = fieldValue;
  }

  return projected;
}

function projectAgentResponse(value: unknown): { agent: Record<string, unknown> } | undefined {
  const response = asRecord(value);
  if (!response) return undefined;

  const agent = projectAgent(response.agent);
  return agent ? { agent } : undefined;
}

function projectAgentListResponse(value: unknown): {
  agents: Record<string, unknown>[];
  next_page_token?: string | null;
} | undefined {
  const response = asRecord(value);
  if (!response || !Array.isArray(response.agents)) return undefined;

  const agents: Record<string, unknown>[] = [];
  for (const candidate of response.agents) {
    const agent = projectAgent(candidate);
    if (!agent) return undefined;
    agents.push(agent);
  }

  const projected: {
    agents: Record<string, unknown>[];
    next_page_token?: string | null;
  } = { agents };

  if (hasOwn(response, 'next_page_token')) {
    if (
      typeof response.next_page_token !== 'string' &&
      response.next_page_token !== null
    ) {
      return undefined;
    }
    projected.next_page_token = response.next_page_token;
  }
  return projected;
}

function invalidApiResponse(): CallToolResult {
  return createErrorResponse('INVALID_API_RESPONSE', INVALID_API_RESPONSE_MESSAGE);
}

export function registerAgentTools(
  server: McpServer,
  client: CovalApiClient,
  { annotationProfile = 'standard' }: { annotationProfile?: ToolAnnotationProfile } = {}
) {
  server.registerTool(
    'list_agents',
    {
      ...readOnlyTool('List agents'),
      description:
        'List agents (AI systems to evaluate). Model types: VOICE, OUTBOUND_VOICE, SMS, WEBSOCKET, and CHAT.',
      inputSchema: ListAgentsInputSchema.shape,
    },
    async (params) => {
      try {
        const result = await client.listAgents(params);
        const projected = projectAgentListResponse(result);
        return projected ? createSuccessResponse(projected) : invalidApiResponse();
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
        'Get agent config: model_type, phone_number (voice), whether a top-level endpoint is configured, and display_name.',
      inputSchema: GetAgentInputSchema.shape,
    },
    async (params) => {
      try {
        const result = await client.getAgent(params.agent_id);
        const projected = projectAgentResponse(result);
        return projected ? createSuccessResponse(projected) : invalidApiResponse();
      } catch (err) {
        return handleApiError(err);
      }
    }
  );

  server.registerTool(
    'create_agent',
    {
      ...createTool('Create agent', { annotationProfile }),
      description:
        'Create a new agent configuration with a model type and connection details.',
      inputSchema: CreateAgentInputSchema.shape,
    },
    async (params) => {
      try {
        const result = await client.createAgent(params);
        const projected = projectAgentResponse(result);
        return projected ? createSuccessResponse(projected) : invalidApiResponse();
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
        'Update an existing agent configuration. Only provided fields are changed.',
      inputSchema: UpdateAgentInputSchema.shape,
    },
    async (params) => {
      try {
        const { agent_id, ...updateData } = params;
        const result = await client.updateAgent(agent_id, updateData);
        const projected = projectAgentResponse(result);
        return projected ? createSuccessResponse(projected) : invalidApiResponse();
      } catch (err) {
        return handleApiError(err);
      }
    }
  );
}
