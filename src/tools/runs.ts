import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../client.js';
import {
  ListRunsInputSchema,
  GetRunInputSchema,
  CreateRunInputSchema,
} from '../schemas/index.js';
import { createErrorResponse, createSuccessResponse } from '../utils/response.js';
import { handleApiError } from '../utils/errors.js';
import {
  createTool,
  readOnlyTool,
  type ToolAnnotationProfile,
} from './annotations.js';

const CLAUDE_ALLOWED_RUN_MODEL_TYPES = new Set([
  'MODEL_TYPE_CHAT',
  'MODEL_TYPE_SMS',
]);
const AUDIO_RUN_MODEL_TYPES = new Set([
  'MODEL_TYPE_VOICE',
  'MODEL_TYPE_OUTBOUND_VOICE',
  'MODEL_TYPE_WEBSOCKET',
]);

function modelTypeFromAgentResponse(response: unknown): string | undefined {
  if (typeof response !== 'object' || response === null || Array.isArray(response)) {
    return undefined;
  }
  const agent = (response as { agent?: unknown }).agent;
  if (typeof agent !== 'object' || agent === null || Array.isArray(agent)) {
    return undefined;
  }
  const modelType = (agent as { model_type?: unknown }).model_type;
  return typeof modelType === 'string' ? modelType : undefined;
}

function claudeRunPolicyError(modelType: string | undefined) {
  if (modelType && AUDIO_RUN_MODEL_TYPES.has(modelType)) {
    return createErrorResponse(
      'CLAUDE_AUDIO_RUN_UNSUPPORTED',
      'The Claude directory connector cannot start voice, outbound voice, or WebSocket voice evaluation runs.',
      'Use a MODEL_TYPE_CHAT or MODEL_TYPE_SMS agent, or start the audio run directly in Coval.'
    );
  }
  return createErrorResponse(
    'CLAUDE_AGENT_TYPE_UNVERIFIED',
    'The agent type could not be verified, so the run was not created.',
    'Choose a verified MODEL_TYPE_CHAT or MODEL_TYPE_SMS agent.'
  );
}

export function registerRunTools(
  server: McpServer,
  client: CovalApiClient,
  { annotationProfile = 'standard' }: { annotationProfile?: ToolAnnotationProfile } = {}
) {
  server.registerTool(
    'list_runs',
    {
      ...readOnlyTool('List runs'),
      description:
        'List evaluation runs. Each run = agent + persona + test_set. Returns run_id, status, tags. Filter by tag: filter=\'tag="regression"\'.',
      inputSchema: ListRunsInputSchema.shape,
    },
    async (params) => {
      try {
        const result = await client.listRuns(params);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );

  server.registerTool(
    'get_run',
    {
      ...readOnlyTool('Get run'),
      description:
        'Get run status/results. Status: PENDING→RUNNING→COMPLETED. Completed runs include metrics (custom per org) and output_ids for transcripts.',
      inputSchema: GetRunInputSchema.shape,
    },
    async (params) => {
      try {
        const result = await client.getRun(params.run_id);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );

  server.registerTool(
    'create_run',
    {
      ...createTool('Create run', {
        annotationProfile,
        irreversible: true,
        openWorldHint: true,
      }),
      description:
        annotationProfile === 'claude'
          ? 'Launch a text evaluation for an agent, persona, and test set. The Claude directory connector supports MODEL_TYPE_CHAT and MODEL_TYPE_SMS agents; it does not start voice, outbound voice, or WebSocket voice runs. Optional tags support result filtering.'
          : 'Launch an evaluation for an agent, persona, and test set. Optional tags support result filtering.',
      inputSchema: CreateRunInputSchema.shape,
    },
    async (params) => {
      try {
        if (annotationProfile === 'claude') {
          const agent = await client.getAgent(params.agent_id);
          const modelType = modelTypeFromAgentResponse(agent);
          if (!modelType || !CLAUDE_ALLOWED_RUN_MODEL_TYPES.has(modelType)) {
            return claudeRunPolicyError(modelType);
          }
        }
        const { tags, ...rest } = params;
        const payload = {
          ...rest,
          metadata: {
            ...((rest.metadata as Record<string, unknown>) || {}),
            ...(tags ? { tags } : {}),
          },
        };
        const result = await client.createRun(payload);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );
}
