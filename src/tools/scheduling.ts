import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../client.js';
import {
  CreateScheduledRunInputSchema,
  GetScheduledRunInputSchema,
  LegacyListRunTemplatesInputSchema,
  LegacyListScheduledRunsInputSchema,
  ListRunTemplatesInputSchema,
  ListScheduledRunsInputSchema,
  UpdateScheduledRunInputSchema,
  type CreateScheduledRunInput,
  type GetScheduledRunInput,
  type LegacyListRunTemplatesInput,
  type LegacyListScheduledRunsInput,
  type ListRunTemplatesInput,
  type ListScheduledRunsInput,
  type UpdateScheduledRunInput,
} from '../schemas/index.js';
import { handleApiError } from '../utils/errors.js';
import { createSuccessResponse } from '../utils/response.js';
import {
  createTool,
  readOnlyTool,
  updateTool,
  type ToolAnnotationProfile,
  type ToolInputProfile,
} from './annotations.js';

export function registerSchedulingTools(
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
    'list_run_templates',
    {
      ...readOnlyTool('List run templates'),
      description:
        'List reusable evaluation configurations in the authorized organization. Returns a bounded page and a continuation token when more are available.',
      inputSchema:
        inputProfile === 'openai'
          ? ListRunTemplatesInputSchema
          : LegacyListRunTemplatesInputSchema,
    },
    async (params: ListRunTemplatesInput | LegacyListRunTemplatesInput) => {
      try {
        const result = await client.listRunTemplates(params);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    },
  );

  server.registerTool(
    'list_scheduled_runs',
    {
      ...readOnlyTool('List scheduled runs'),
      description:
        'List recurring evaluation schedules. Results can be filtered by enabled state or run template and are returned as a bounded page.',
      inputSchema:
        inputProfile === 'openai'
          ? ListScheduledRunsInputSchema
          : LegacyListScheduledRunsInputSchema,
    },
    async (params: ListScheduledRunsInput | LegacyListScheduledRunsInput) => {
      try {
        const result = await client.listScheduledRuns(params);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    },
  );

  server.registerTool(
    'get_scheduled_run',
    {
      ...readOnlyTool('Get scheduled run'),
      description:
        'Retrieve one recurring evaluation schedule plus a bounded slice of its most recent triggered runs. Inspect history_scope.has_more before assuming the history is complete.',
      inputSchema: GetScheduledRunInputSchema,
    },
    async (params: GetScheduledRunInput) => {
      try {
        const historySize = params.history_size ?? 20;
        const [scheduledRunResult, historyResult] = await Promise.all([
          client.getScheduledRun(params.scheduled_run_id),
          client.listScheduledRunHistory(params.scheduled_run_id),
        ]);
        const runs = historyResult.runs.slice(0, historySize);
        return createSuccessResponse({
          scheduled_run: scheduledRunResult.scheduled_run,
          runs,
          history_scope: {
            returned: runs.length,
            available: historyResult.runs.length,
            has_more: historyResult.runs.length > runs.length,
          },
        });
      } catch (err) {
        return handleApiError(err);
      }
    },
  );

  server.registerTool(
    'create_scheduled_run',
    {
      ...createTool('Create scheduled run', {
        annotationProfile,
        irreversible: true,
        openWorldHint: true,
      }),
      description:
        'Create a recurring evaluation schedule from a run template. New schedules remain disabled unless enabled is explicitly true; enabling can trigger future external evaluation activity and costs.',
      inputSchema: CreateScheduledRunInputSchema,
    },
    async (params: CreateScheduledRunInput) => {
      try {
        const result = await client.createScheduledRun({
          ...params,
          enabled: params.enabled ?? false,
        });
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    },
  );

  server.registerTool(
    'update_scheduled_run',
    {
      ...updateTool('Update scheduled run', { openWorldHint: true }),
      description:
        'Update selected fields on one recurring evaluation schedule. Enabling or changing timing can trigger future external evaluation activity and costs.',
      inputSchema: UpdateScheduledRunInputSchema,
    },
    async (params: UpdateScheduledRunInput) => {
      try {
        const { scheduled_run_id: scheduledRunId, ...updates } = params;
        const result = await client.updateScheduledRun(scheduledRunId, updates);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    },
  );
}
