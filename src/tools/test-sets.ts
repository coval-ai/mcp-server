import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../client.js';
import {
  ListTestSetsInputSchema,
  GetTestSetInputSchema,
  CreateTestSetInputSchema,
} from '../schemas/index.js';
import { createSuccessResponse } from '../utils/response.js';
import { handleApiError } from '../utils/errors.js';
import { readOnlyTool, writeTool } from './annotations.js';

export function registerTestSetTools(server: McpServer, client: CovalApiClient) {
  server.registerTool(
    'list_test_sets',
    {
      title: 'List test sets',
      description:
        'List test sets (collections of test cases). Each contains scenarios to run against an agent. Use test_set_id when creating runs.',
      inputSchema: ListTestSetsInputSchema.shape,
      annotations: readOnlyTool(),
    },
    async (params) => {
      try {
        const result = await client.listTestSets(params);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );

  server.registerTool(
    'get_test_set',
    {
      title: 'Get test set',
      description:
        'Get test set details: display_name, description, and test case count. Use list_test_cases to see individual scenarios.',
      inputSchema: GetTestSetInputSchema.shape,
      annotations: readOnlyTool(),
    },
    async (params) => {
      try {
        const result = await client.getTestSet(params.test_set_id);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );

  server.registerTool(
    'create_test_set',
    {
      title: 'Create test set',
      description:
        'Create a test set to organize test cases. After creating, use create_test_case to add scenarios.',
      inputSchema: CreateTestSetInputSchema.shape,
      annotations: writeTool(),
    },
    async (params) => {
      try {
        const result = await client.createTestSet(params);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );
}
