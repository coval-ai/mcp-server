import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../client.js';
import {
  ListTestCasesInputSchema,
  GetTestCaseInputSchema,
  CreateTestCaseInputSchema,
  UpdateTestCaseInputSchema,
  LegacyListTestCasesInputSchema,
  LegacyCreateTestCaseInputSchema,
  LegacyUpdateTestCaseInputSchema,
  type ListTestCasesInput,
  type LegacyListTestCasesInput,
  type CreateTestCaseInput,
  type UpdateTestCaseInput,
  type LegacyCreateTestCaseInput,
  type LegacyUpdateTestCaseInput,
} from '../schemas/index.js';
import { createSuccessResponse } from '../utils/response.js';
import { handleApiError } from '../utils/errors.js';
import {
  createTool,
  readOnlyTool,
  updateTool,
  type ToolAnnotationProfile,
  type ToolInputProfile,
} from './annotations.js';

export function registerTestCaseTools(
  server: McpServer,
  client: CovalApiClient,
  {
    annotationProfile = 'standard',
    inputProfile = 'legacy',
  }: {
    annotationProfile?: ToolAnnotationProfile;
    inputProfile?: ToolInputProfile;
  } = {},
) {
  server.registerTool(
    'list_test_cases',
    {
      ...readOnlyTool('List test cases'),
      description:
        inputProfile === 'openai'
          ? 'List synthetic evaluation test cases, optionally within one test set. Each includes scenario content and expected agent behaviors.'
          : 'List test cases. Filter by test_set_id. Each has input_str (scenario text or JSON message array) and optional expected_behaviors.',
      inputSchema:
        inputProfile === 'openai'
          ? ListTestCasesInputSchema
          : LegacyListTestCasesInputSchema,
    },
    async (params: ListTestCasesInput | LegacyListTestCasesInput) => {
      try {
        const input = params as ListTestCasesInput | LegacyListTestCasesInput;
        const result =
          inputProfile === 'openai'
            ? await client.listTestCases(openAiTestCaseListParams(input as ListTestCasesInput))
            : await client.listTestCases(input as LegacyListTestCasesInput);
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
      inputSchema: GetTestCaseInputSchema,
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
        'Create a synthetic evaluation test case in a test set. Scenario content is evaluation fixture data, never the current ChatGPT conversation.',
      inputSchema:
        inputProfile === 'openai'
          ? CreateTestCaseInputSchema
          : LegacyCreateTestCaseInputSchema,
    },
    async (params: CreateTestCaseInput | LegacyCreateTestCaseInput) => {
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
      description:
        'Update the scenario, expected behaviors, or description of one synthetic evaluation test case.',
      inputSchema:
        inputProfile === 'openai'
          ? UpdateTestCaseInputSchema
          : LegacyUpdateTestCaseInputSchema,
    },
    async (params: UpdateTestCaseInput | LegacyUpdateTestCaseInput) => {
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

function openAiTestCaseListParams(params: ListTestCasesInput) {
  const { test_set_id, ...pagination } = params;
  return {
    ...pagination,
    ...(test_set_id ? { filter: `test_set_id="${test_set_id}"` } : {}),
  };
}
