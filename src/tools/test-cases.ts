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
import {
  createTool,
  readOnlyTool,
  updateTool,
  type ToolAnnotationProfile,
} from './annotations.js';

export function registerTestCaseTools(
  server: McpServer,
  client: CovalApiClient,
  { annotationProfile = 'standard' }: { annotationProfile?: ToolAnnotationProfile } = {}
) {
  server.registerTool(
    'list_test_cases',
    {
      ...readOnlyTool('List test cases'),
      description:
        'List test cases. Filter by test_set_id. Each has input_str (scenario text or JSON message array) and optional expected_behaviors.',
      inputSchema: ListTestCasesInputSchema.shape,
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
      ...readOnlyTool('Get test case'),
      description:
        'Get test case details: input_str (the scenario), expected_behaviors, and metadata.',
      inputSchema: GetTestCaseInputSchema.shape,
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
      ...createTool('Create test case', { annotationProfile }),
      description:
        'Create test case in a test set. input_str: single scenario message OR JSON array [{role,content},...] for multi-turn conversations.',
      inputSchema: CreateTestCaseInputSchema.shape,
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
      ...updateTool('Update test case'),
      description: 'Update test case input_str, expected_behaviors, or other fields.',
      inputSchema: UpdateTestCaseInputSchema.shape,
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
