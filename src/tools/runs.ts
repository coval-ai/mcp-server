import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../client.js';
import {
  ListRunsInputSchema,
  GetRunInputSchema,
  CreateRunInputSchema,
} from '../schemas/index.js';
import { createSuccessResponse } from '../utils/response.js';
import { handleApiError } from '../utils/errors.js';
import { READ_ONLY_TOOL, WRITE_TOOL } from './annotations.js';

export function registerRunTools(server: McpServer, client: CovalApiClient) {
  server.tool(
    'list_runs',
    'List evaluation runs. Each run = agent + persona + test_set. Returns run_id, status, tags. Filter by tag: filter=\'tag="regression"\'.',
    ListRunsInputSchema.shape,
    READ_ONLY_TOOL,
    async (params) => {
      try {
        const result = await client.listRuns(params);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );

  server.tool(
    'get_run',
    'Get run status/results. Status: PENDING→RUNNING→COMPLETED. Completed runs include metrics (custom per org) and output_ids for transcripts.',
    GetRunInputSchema.shape,
    READ_ONLY_TOOL,
    async (params) => {
      try {
        const result = await client.getRun(params.run_id);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );

  server.tool(
    'create_run',
    'Launch evaluation: agent + persona + test_set. Optionally add tags for filtering. Poll get_run until status=COMPLETED to see metrics.',
    CreateRunInputSchema.shape,
    WRITE_TOOL,
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
