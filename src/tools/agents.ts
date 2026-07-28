import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { CovalApiClient } from '../client.js';
import {
  ListAgentsInputSchema,
  GetAgentInputSchema,
  CreateAgentInputSchema,
  UpdateAgentInputSchema,
  LegacyCreateAgentInputSchema,
  LegacyUpdateAgentInputSchema,
  type CreateAgentInput,
  type UpdateAgentInput,
  type LegacyCreateAgentInput,
  type LegacyUpdateAgentInput,
} from '../schemas/index.js';
import { createErrorResponse, createSuccessResponse } from '../utils/response.js';
import { handleApiError } from '../utils/errors.js';
import {
  createTool,
  readOnlyTool,
  updateTool,
  type ToolAnnotationProfile,
  type ToolInputProfile,
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

function usesProtocol(value: string | undefined, protocols: readonly string[]): boolean {
  if (!value) return false;
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function openAiCreateAgentError(params: CreateAgentInput): string | undefined {
  switch (params.model_type) {
    case 'MODEL_TYPE_VOICE':
      if (!params.phone_number) {
        return 'MODEL_TYPE_VOICE requires an E.164 phone number or SIP address.';
      }
      if (params.endpoint) return 'MODEL_TYPE_VOICE does not use endpoint.';
      return undefined;
    case 'MODEL_TYPE_SMS':
      if (!params.phone_number?.startsWith('+')) {
        return 'MODEL_TYPE_SMS requires an E.164 phone number.';
      }
      if (params.endpoint) return 'MODEL_TYPE_SMS does not use endpoint.';
      return undefined;
    case 'MODEL_TYPE_OUTBOUND_VOICE':
    case 'MODEL_TYPE_CHAT':
      if (!usesProtocol(params.endpoint, ['http:', 'https:'])) {
        return `${params.model_type} requires an HTTP(S) endpoint.`;
      }
      if (params.phone_number) return `${params.model_type} does not use phone_number.`;
      return undefined;
    case 'MODEL_TYPE_WEBSOCKET':
      if (!usesProtocol(params.endpoint, ['wss:'])) {
        return 'MODEL_TYPE_WEBSOCKET requires a secure WSS endpoint.';
      }
      if (params.phone_number) return 'MODEL_TYPE_WEBSOCKET does not use phone_number.';
      return undefined;
  }
}

function createAgentPayload(params: CreateAgentInput) {
  const { display_name, model_type, prompt } = params;
  const common = {
    display_name,
    model_type,
    ...(prompt ? { prompt } : {}),
  };

  switch (model_type) {
    case 'MODEL_TYPE_CHAT':
      return {
        ...common,
        metadata: { chat_endpoint: params.endpoint },
      };
    case 'MODEL_TYPE_WEBSOCKET':
      return {
        ...common,
        metadata: { endpoint: params.endpoint },
      };
    case 'MODEL_TYPE_OUTBOUND_VOICE':
      return {
        ...common,
        endpoint: params.endpoint,
      };
    case 'MODEL_TYPE_VOICE':
    case 'MODEL_TYPE_SMS':
      return {
        ...common,
        phone_number: params.phone_number,
      };
  }
}

function openAiAgentUpdateError(
  params: UpdateAgentInput,
  currentAgent: Record<string, unknown> | undefined,
): string | undefined {
  const connectionFields = [
    params.phone_number,
    params.outbound_voice_endpoint,
    params.chat_endpoint,
    params.websocket_endpoint,
  ].filter((value) => value !== undefined);
  if (connectionFields.length > 1) {
    return 'Update only one model-specific connection field at a time.';
  }
  if (connectionFields.length === 0) return undefined;
  if (!currentAgent || typeof currentAgent.model_type !== 'string') {
    return 'The current agent type could not be verified.';
  }

  const modelType = currentAgent.model_type;
  if (
    params.phone_number &&
    !['MODEL_TYPE_VOICE', 'MODEL_TYPE_SMS'].includes(modelType)
  ) {
    return 'phone_number can update only a VOICE or SMS agent.';
  }
  if (
    params.phone_number?.startsWith('sip:') &&
    modelType === 'MODEL_TYPE_SMS'
  ) {
    return 'SMS agents require an E.164 phone number.';
  }
  if (
    params.outbound_voice_endpoint &&
    modelType !== 'MODEL_TYPE_OUTBOUND_VOICE'
  ) {
    return 'outbound_voice_endpoint can update only an OUTBOUND_VOICE agent.';
  }
  if (
    params.chat_endpoint &&
    !['MODEL_TYPE_CHAT', 'MODEL_TYPE_CHAT_A2A'].includes(modelType)
  ) {
    return 'chat_endpoint can update only a CHAT agent.';
  }
  if (
    params.websocket_endpoint &&
    !['MODEL_TYPE_WEBSOCKET', 'MODEL_TYPE_CHAT_WEBSOCKET'].includes(modelType)
  ) {
    return 'websocket_endpoint can update only a WEBSOCKET agent.';
  }
  return undefined;
}

function openAiAgentUpdatePayload(
  params: UpdateAgentInput,
  currentAgent: Record<string, unknown> | undefined,
) {
  const base = {
    ...(params.display_name !== undefined
      ? { display_name: params.display_name }
      : {}),
    ...(params.phone_number !== undefined
      ? { phone_number: params.phone_number }
      : {}),
    ...(params.prompt !== undefined ? { prompt: params.prompt } : {}),
  };
  const metadata = asRecord(currentAgent?.metadata) || {};

  if (params.outbound_voice_endpoint) {
    return { ...base, endpoint: params.outbound_voice_endpoint };
  }
  if (params.chat_endpoint) {
    return { ...base, metadata: { ...metadata, chat_endpoint: params.chat_endpoint } };
  }
  if (params.websocket_endpoint) {
    return {
      ...base,
      metadata: { ...metadata, endpoint: params.websocket_endpoint },
    };
  }
  return base;
}

export function registerAgentTools(
  server: McpServer,
  client: CovalApiClient,
  {
    annotationProfile = 'standard',
    inputProfile = 'legacy',
  }: {
    annotationProfile?: ToolAnnotationProfile;
    inputProfile?: ToolInputProfile;
  } = {},
) {
  server.registerTool(
    'list_agents',
    {
      ...readOnlyTool('List agents'),
      description:
        'List agents (AI systems to evaluate). Model types: VOICE, OUTBOUND_VOICE, SMS, WEBSOCKET, and CHAT.',
      inputSchema: ListAgentsInputSchema,
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
      inputSchema: GetAgentInputSchema,
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
        inputProfile === 'openai'
          ? 'Create an agent configuration. The selected model type requires its matching connection field: phone number or SIP address for VOICE, E.164 phone number for SMS, HTTP endpoint for OUTBOUND_VOICE or CHAT, and WSS endpoint for WEBSOCKET.'
          : 'Create a new agent configuration with a model type and connection details.',
      inputSchema:
        inputProfile === 'openai'
          ? CreateAgentInputSchema
          : LegacyCreateAgentInputSchema,
    },
    async (params: CreateAgentInput | LegacyCreateAgentInput) => {
      try {
        const input = params as CreateAgentInput | LegacyCreateAgentInput;
        if (inputProfile === 'openai') {
          const openAiInput = input as CreateAgentInput;
          const validationError = openAiCreateAgentError(openAiInput);
          if (validationError) {
            return createErrorResponse(
              'INVALID_AGENT_CONFIGURATION',
              validationError,
              'Provide only the connection field required by the selected model type.',
            );
          }
          const result = await client.createAgent(createAgentPayload(openAiInput));
          const projected = projectAgentResponse(result);
          return projected ? createSuccessResponse(projected) : invalidApiResponse();
        }
        const result = await client.createAgent(input as LegacyCreateAgentInput);
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
      inputSchema:
        inputProfile === 'openai'
          ? UpdateAgentInputSchema
          : LegacyUpdateAgentInputSchema,
    },
    async (params: UpdateAgentInput | LegacyUpdateAgentInput) => {
      try {
        if (inputProfile === 'openai') {
          const input = params as UpdateAgentInput;
          const needsCurrentAgent = Boolean(
            input.phone_number ||
              input.outbound_voice_endpoint ||
              input.chat_endpoint ||
              input.websocket_endpoint,
          );
          const currentResponse = needsCurrentAgent
            ? await client.getAgent(input.agent_id)
            : undefined;
          const currentAgent = currentResponse
            ? asRecord(currentResponse.agent)
            : undefined;
          const validationError = openAiAgentUpdateError(input, currentAgent);
          if (validationError) {
            return createErrorResponse(
              'INVALID_AGENT_CONFIGURATION',
              validationError,
              'Choose the connection field that matches the existing agent type.',
            );
          }
          const result = await client.updateAgent(
            input.agent_id,
            openAiAgentUpdatePayload(input, currentAgent),
          );
          const projected = projectAgentResponse(result);
          return projected ? createSuccessResponse(projected) : invalidApiResponse();
        }
        const { agent_id, ...updateData } = params as LegacyUpdateAgentInput;
        const result = await client.updateAgent(agent_id, updateData);
        const projected = projectAgentResponse(result);
        return projected ? createSuccessResponse(projected) : invalidApiResponse();
      } catch (err) {
        return handleApiError(err);
      }
    }
  );
}
