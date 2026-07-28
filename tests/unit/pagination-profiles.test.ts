import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodTypeAny } from 'zod';
import { CovalApiClient } from '../../src/client.js';
import type { ToolInputProfile } from '../../src/tools/annotations.js';
import { registerAllTools } from '../../src/tools/index.js';

interface ToolRegistration {
  inputSchema?: unknown;
}

function collectListSchemas(inputProfile: ToolInputProfile) {
  const registrations = new Map<string, ToolRegistration>();
  const server = {
    registerTool: (name: string, config: ToolRegistration) => {
      registrations.set(name, config);
    },
  } as unknown as McpServer;

  registerAllTools(server, new CovalApiClient('customer-api-key'), {
    inputProfile,
  });

  return registrations;
}

describe('pagination input profiles', () => {
  it.each([
    'list_agents',
    'list_runs',
    'list_test_sets',
    'list_test_cases',
    'list_personas',
    'list_metrics',
  ])(
    'keeps %s strict for OpenAI and permissive for legacy callers',
    (toolName) => {
      const input = {
        page_size: 10,
        legacy_extension: 'ignored',
      };
      const openAiSchema = collectListSchemas('openai').get(toolName)
        ?.inputSchema as ZodTypeAny;
      const legacySchema = collectListSchemas('legacy').get(toolName)
        ?.inputSchema as ZodTypeAny;

      expect(openAiSchema.safeParse(input).success).toBe(false);
      expect(legacySchema.safeParse(input)).toMatchObject({
        success: true,
        data: { page_size: 10 },
      });
    },
  );
});
