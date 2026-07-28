import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../client.js';
import {
  ListTestSetsInputSchema,
  GetTestSetInputSchema,
  CreateTestSetInputSchema,
  LegacyCreateTestSetInputSchema,
  type CreateTestSetInput,
  type LegacyCreateTestSetInput,
} from '../schemas/index.js';
import { createSuccessResponse } from '../utils/response.js';
import { handleApiError } from '../utils/errors.js';
import {
  createTool,
  readOnlyTool,
  type ToolAnnotationProfile,
  type ToolInputProfile,
} from './annotations.js';

export function registerTestSetTools(
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
    'list_test_sets',
    {
      ...readOnlyTool('List test sets'),
      description:
        'List test sets (collections of test cases). Each contains evaluation scenarios and returns its ID, name, description, and test case count.',
      inputSchema: ListTestSetsInputSchema,
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
      ...readOnlyTool('Get test set'),
      description:
        'Get test set details: display_name, description, and test case count.',
      inputSchema: GetTestSetInputSchema,
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
      ...createTool('Create test set', { annotationProfile }),
      description: 'Create a test set for organizing evaluation scenarios.',
      inputSchema:
        inputProfile === 'openai'
          ? CreateTestSetInputSchema
          : LegacyCreateTestSetInputSchema,
    },
    async (params: CreateTestSetInput | LegacyCreateTestSetInput) => {
      try {
        const result = await client.createTestSet(params);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );
}
