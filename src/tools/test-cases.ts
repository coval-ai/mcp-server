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
    'List test cases. Filter by test_set_id. Each has input_str (scenario text or JSON message array) and optional expected_behaviors.',
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
    'Get test case details: input_str (the scenario), expected_behaviors, and metadata.',
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
    'Create test case in a test set. input_str: single scenario message OR JSON array [{role,content},...] for multi-turn conversations.',
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
    'Update test case input_str, expected_behaviors, or other fields.',
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
