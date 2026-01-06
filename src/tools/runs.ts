import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../client.js';
import {
  ListRunsInputSchema,
  GetRunInputSchema,
  CreateRunInputSchema,
  DeleteRunInputSchema,
} from '../schemas/index.js';
import { createSuccessResponse } from '../utils/response.js';
import { handleApiError } from '../utils/errors.js';

export function registerRunTools(server: McpServer, client: CovalApiClient) {
  server.tool(
    'list_runs',
    'List evaluation runs. Use this to see all runs, filter by status, or paginate through results. Returns run IDs, status, agent, and test set info.',
    ListRunsInputSchema.shape,
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
    'Get detailed information about a specific run. Use this to check run status, progress, and results (including metrics for completed runs).',
    GetRunInputSchema.shape,
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
    'Launch a new evaluation run. Requires agent_id (from list_agents), persona_id (from list_personas), and test_set_id (from list_test_sets). Optionally specify metrics and run options.',
    CreateRunInputSchema.shape,
    async (params) => {
      try {
        const result = await client.createRun(params);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );

  server.tool(
    'delete_run',
    'Cancel an in-progress run or delete a completed run. Use get_run first to check the current status.',
    DeleteRunInputSchema.shape,
    async (params) => {
      try {
        await client.deleteRun(params.run_id);
        return createSuccessResponse({ status: 'deleted', run_id: params.run_id });
      } catch (err) {
        return handleApiError(err);
      }
    }
  );
}
