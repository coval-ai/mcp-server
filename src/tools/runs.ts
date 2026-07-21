import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../client.js';
import {
  ListRunsInputSchema,
  GetRunInputSchema,
  CreateRunInputSchema,
} from '../schemas/index.js';
import { createSuccessResponse } from '../utils/response.js';
import { handleApiError } from '../utils/errors.js';
import { readOnlyTool, writeTool } from './annotations.js';

export function registerRunTools(server: McpServer, client: CovalApiClient) {
  server.registerTool(
    'list_runs',
    {
      title: 'List runs',
      description:
        'List evaluation runs. Each run = agent + persona + test_set. Returns run_id, status, tags. Filter by tag: filter=\'tag="regression"\'.',
      inputSchema: ListRunsInputSchema.shape,
      annotations: readOnlyTool(),
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
      title: 'Get run',
      description:
        'Get run status/results. Status: PENDING→RUNNING→COMPLETED. Completed runs include metrics (custom per org) and output_ids for transcripts.',
      inputSchema: GetRunInputSchema.shape,
      annotations: readOnlyTool(),
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
      title: 'Create run',
      description:
        'Launch evaluation: agent + persona + test_set. Optionally add tags for filtering. Poll get_run until status=COMPLETED to see metrics.',
      inputSchema: CreateRunInputSchema.shape,
      annotations: writeTool({ openWorldHint: true }),
    },
    async (params) => {
      try {
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
