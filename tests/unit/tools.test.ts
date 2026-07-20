import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../../src/client.js';
import { registerAllTools } from '../../src/tools/index.js';

describe('registerAllTools', () => {
  it('registers complete directory metadata for every tool', () => {
    const toolNames: string[] = [];
    const annotations = new Map<
      string,
      { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean }
    >();
    const server = {
      tool: (
        name: string,
        _description: string,
        _schema: unknown,
        hints: { title?: string; readOnlyHint?: boolean; destructiveHint?: boolean }
      ) => {
        toolNames.push(name);
        annotations.set(name, hints);
      }
    } as unknown as McpServer;

    registerAllTools(server, new CovalApiClient('customer-api-key'));

    expect(toolNames).toContain('consult_covi');
    expect(annotations.get('consult_covi')?.readOnlyHint).toBe(true);
    expect(annotations.get('list_runs')?.readOnlyHint).toBe(true);
    expect(annotations.get('create_run')?.readOnlyHint).toBe(false);
    expect(annotations.get('create_run')?.destructiveHint).toBe(false);
    expect(annotations.get('update_agent')?.destructiveHint).toBe(true);
    expect(annotations.get('update_test_case')?.destructiveHint).toBe(true);
    expect(toolNames).toHaveLength(19);

    for (const name of toolNames) {
      const metadata = annotations.get(name);
      expect(metadata?.title).toBeTruthy();
      expect(typeof metadata?.readOnlyHint).toBe('boolean');
      expect(typeof metadata?.destructiveHint).toBe('boolean');
    }
  });
});
