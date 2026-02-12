import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../client.js';
import {
  ListRunsInputSchema,
  GetRunInputSchema,
  CreateRunInputSchema,
} from '../schemas/index.js';
import { createSuccessResponse } from '../utils/response.js';
import { handleApiError } from '../utils/errors.js';

export function registerRunTools(server: McpServer, client: CovalApiClient) {
  server.tool(
    'list_runs',
    'List evaluation runs. Each run = agent + persona + test_set. Returns run_id, status (PENDING/RUNNING/COMPLETED), agent_id, persona_id, test_set_id.',
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
    'Get run status/results. Status: PENDING→RUNNING→COMPLETED. Completed runs include metrics (custom per org) and output_ids for transcripts.',
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
    'Launch evaluation: agent + persona + test_set. Persona calls/texts the agent for each test case. Poll get_run until status=COMPLETED to see metrics.',
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
}
