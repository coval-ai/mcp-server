import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../client.js';
import {
  ListTestSetsInputSchema,
  GetTestSetInputSchema,
  CreateTestSetInputSchema,
} from '../schemas/index.js';
import { createSuccessResponse } from '../utils/response.js';
import { handleApiError } from '../utils/errors.js';

export function registerTestSetTools(server: McpServer, client: CovalApiClient) {
  server.tool(
    'list_test_sets',
    'List all test sets. Use this to find test set IDs for creating runs. Test sets contain test cases for evaluating agents.',
    ListTestSetsInputSchema.shape,
    async (params) => {
      try {
        const result = await client.listTestSets(params);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );

  server.tool(
    'get_test_set',
    'Get detailed information about a test set. Shows description, type, parameters, and test case count.',
    GetTestSetInputSchema.shape,
    async (params) => {
      try {
        const result = await client.getTestSet(params.test_set_id);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );

  server.tool(
    'create_test_set',
    'Create a new test set. Test sets organize test cases and can define parameters for test case generation.',
    CreateTestSetInputSchema.shape,
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
