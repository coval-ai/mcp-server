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
import { readOnlyTool, updateTool, writeTool } from './annotations.js';

export function registerTestCaseTools(server: McpServer, client: CovalApiClient) {
  server.registerTool(
    'list_test_cases',
    {
      title: 'List test cases',
      description:
        'List test cases. Filter by test_set_id. Each has input_str (scenario text or JSON message array) and optional expected_behaviors.',
      inputSchema: ListTestCasesInputSchema.shape,
      annotations: readOnlyTool(),
    },
    async (params) => {
      try {
        const result = await client.listTestCases(params);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );

  server.registerTool(
    'get_test_case',
    {
      title: 'Get test case',
      description:
        'Get test case details: input_str (the scenario), expected_behaviors, and metadata.',
      inputSchema: GetTestCaseInputSchema.shape,
      annotations: readOnlyTool(),
    },
    async (params) => {
      try {
        const result = await client.getTestCase(params.test_case_id);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );

  server.registerTool(
    'create_test_case',
    {
      title: 'Create test case',
      description:
        'Create test case in a test set. input_str: single scenario message OR JSON array [{role,content},...] for multi-turn conversations.',
      inputSchema: CreateTestCaseInputSchema.shape,
      annotations: writeTool(),
    },
    async (params) => {
      try {
        const result = await client.createTestCase(params);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );

  server.registerTool(
    'update_test_case',
    {
      title: 'Update test case',
      description: 'Update test case input_str, expected_behaviors, or other fields.',
      inputSchema: UpdateTestCaseInputSchema.shape,
      annotations: updateTool(),
    },
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
