import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../client.js';
import {
  CancelPythonMetricPreviewInputSchema,
  CreatePythonMetricDraftInputSchema,
  CreatePythonMetricPreviewInputSchema,
  GetPythonMetricDraftInputSchema,
  GetPythonMetricPreviewInputSchema,
  PublishPythonMetricDraftInputSchema,
} from '../schemas/python-metrics.js';
import { createSuccessResponse } from '../utils/response.js';
import { handleApiError } from '../utils/errors.js';
import {
  createTool,
  readOnlyTool,
  updateTool,
  type ToolAnnotationProfile,
} from './annotations.js';

export function registerPythonMetricTools(
  server: McpServer,
  client: CovalApiClient,
  { annotationProfile = 'standard' }: { annotationProfile?: ToolAnnotationProfile } = {},
) {
  server.registerTool(
    'create_python_metric_draft',
    {
      ...createTool('Create Python metric draft', { annotationProfile }),
      description:
        'Create an immutable Python metric draft. Source or input/output changes require a new draft and new previews. Create an asynchronous preview for a historical conversation before publishing.',
      inputSchema: CreatePythonMetricDraftInputSchema,
    },
    async (params) => {
      try {
        return createSuccessResponse(await client.createPythonMetricDraft(params));
      } catch (err) {
        return handleApiError(err);
      }
    },
  );

  server.registerTool(
    'get_python_metric_draft',
    {
      ...readOnlyTool('Get Python metric draft'),
      description: 'Get an immutable Python metric draft and its fingerprint.',
      inputSchema: GetPythonMetricDraftInputSchema,
    },
    async (params) => {
      try {
        return createSuccessResponse(await client.getPythonMetricDraft(params.draft_id));
      } catch (err) {
        return handleApiError(err);
      }
    },
  );

  server.registerTool(
    'create_python_metric_preview',
    {
      ...createTool('Create Python metric preview', { annotationProfile }),
      description:
        'Start an asynchronous preview of an immutable Python metric draft. Preview execution is asynchronous; poll the preview until it reaches a terminal state. Publish only after successful previews.',
      inputSchema: CreatePythonMetricPreviewInputSchema,
    },
    async (params) => {
      try {
        return createSuccessResponse(
          await client.createPythonMetricPreview(params.draft_id, {
            simulation_output_ids: params.simulation_output_ids,
          }),
        );
      } catch (err) {
        return handleApiError(err);
      }
    },
  );

  server.registerTool(
    'get_python_metric_preview',
    {
      ...readOnlyTool('Get Python metric preview'),
      description:
        'Get the state and result of an asynchronous Python metric preview. Poll this tool until the preview reaches a terminal state; publish only with successful preview IDs for the exact draft.',
      inputSchema: GetPythonMetricPreviewInputSchema,
    },
    async (params) => {
      try {
        return createSuccessResponse(
          await client.getPythonMetricPreview(params.draft_id, params.preview_id),
        );
      } catch (err) {
        return handleApiError(err);
      }
    },
  );

  server.registerTool(
    'cancel_python_metric_preview',
    {
      ...updateTool('Cancel Python metric preview'),
      description: 'Cancel an in-progress Python metric preview.',
      inputSchema: CancelPythonMetricPreviewInputSchema,
    },
    async (params) => {
      try {
        return createSuccessResponse(
          await client.cancelPythonMetricPreview(params.draft_id, params.preview_id),
        );
      } catch (err) {
        return handleApiError(err);
      }
    },
  );

  server.registerTool(
    'publish_python_metric_draft',
    {
      ...createTool('Publish Python metric draft', { annotationProfile }),
      description:
        'Publish the exact immutable Python metric draft identified by its fingerprint. Supply only successful preview IDs for this draft.',
      inputSchema: PublishPythonMetricDraftInputSchema,
    },
    async (params) => {
      try {
        return createSuccessResponse(
          await client.publishPythonMetricDraft(params.draft_id, {
            preview_ids: params.preview_ids,
            fingerprint: params.fingerprint,
          }),
        );
      } catch (err) {
        return handleApiError(err);
      }
    },
  );
}
