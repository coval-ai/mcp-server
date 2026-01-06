import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../client.js';
import {
  ListTestCasesInputSchema,
  GetTestCaseInputSchema,
  CreateTestCaseInputSchema,
  UpdateTestCaseInputSchema,
} from '../schemas/index.js';
import { createSuccessResponse } from '../utils/response.js';
import { handleApiError } from '../utils/errors.js';

export function registerTestCaseTools(server: McpServer, client: CovalApiClient) {
  server.tool(
    'list_test_cases',
    'List test cases. Filter by test set using filter="test_set_id=\\"abc12345\\"". Returns test case IDs, inputs, and expected behaviors.',
    ListTestCasesInputSchema.shape,
    async (params) => {
      try {
        const result = await client.listTestCases(params);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );

  server.tool(
    'get_test_case',
    'Get detailed information about a specific test case including its input, expected behaviors, and metadata.',
    GetTestCaseInputSchema.shape,
    async (params) => {
      try {
        const result = await client.getTestCase(params.test_case_id);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );

  server.tool(
    'create_test_case',
    'Create a new test case within a test set. Requires test_set_id and input_str. Optionally specify expected_behaviors for evaluation.',
    CreateTestCaseInputSchema.shape,
    async (params) => {
      try {
        const result = await client.createTestCase(params);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );

  server.tool(
    'update_test_case',
    'Update an existing test case. Can modify input_str, expected_behaviors, description, and other fields.',
    UpdateTestCaseInputSchema.shape,
    async (params) => {
      try {
        const { test_case_id, ...updateData } = params;
        const result = await client.updateTestCase(test_case_id, updateData);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );
}
