import { jest } from '@jest/globals';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { CovalApiClient } from '../../src/client.js';
import { registerTestCaseTools } from '../../src/tools/test-cases.js';

type ToolHandler = (params: Record<string, unknown>) => Promise<CallToolResult>;

function responsePayload(result: CallToolResult): Record<string, unknown> {
  const content = result.content[0];
  if (content?.type !== 'text') throw new Error('Expected a text tool response');
  return JSON.parse(content.text) as Record<string, unknown>;
}

function registerListTestCasesTool() {
  let handler: ToolHandler | undefined;
  const server = {
    registerTool: (name: string, _config: unknown, toolHandler: ToolHandler) => {
      if (name === 'list_test_cases') handler = toolHandler;
    },
  } as unknown as McpServer;
  const listTestCases = jest.fn(async () => ({ test_cases: [] }));
  const client = { listTestCases } as unknown as CovalApiClient;

  registerTestCaseTools(server, client, { inputProfile: 'openai' });
  if (!handler) throw new Error('list_test_cases was not registered');
  return { handler, listTestCases };
}

describe('OpenAI list_test_cases filter safety', () => {
  it('builds a bounded filter for a valid test-set ID', async () => {
    const { handler, listTestCases } = registerListTestCasesTool();

    const result = await handler({ test_set_id: 'Ab12Cd34', page_size: 10 });

    expect(listTestCases).toHaveBeenCalledWith({
      filter: 'test_set_id="Ab12Cd34"',
      page_size: 10,
    });
    expect(result.isError).not.toBe(true);
  });

  it('rejects a filter-breaking ID even if a caller bypasses schema validation', async () => {
    const { handler, listTestCases } = registerListTestCasesTool();

    const result = await handler({ test_set_id: 'Ab12Cd3"' });

    expect(listTestCases).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(responsePayload(result)).toEqual({
      error: 'INVALID_ARGUMENT',
      message: 'The test set ID must be exactly eight letters or digits.',
    });
  });
});
