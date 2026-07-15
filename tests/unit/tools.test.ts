import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../../src/client.js';
import { registerAllTools } from '../../src/tools/index.js';

describe('registerAllTools', () => {
  it('registers consult_covi for the local stdio server by default', () => {
    const toolNames: string[] = [];
    const annotations = new Map<string, { readOnlyHint?: boolean }>();
    const server = {
      tool: (name: string, _description: string, _schema: unknown, hints: { readOnlyHint?: boolean }) => {
        toolNames.push(name);
        annotations.set(name, hints);
      }
    } as unknown as McpServer;

    registerAllTools(server, new CovalApiClient('customer-api-key'));

    expect(toolNames).toContain('consult_covi');
    expect(annotations.get('consult_covi')?.readOnlyHint).toBe(true);
    expect(annotations.get('list_runs')?.readOnlyHint).toBe(true);
    expect(annotations.get('create_run')?.readOnlyHint).toBe(false);
  });
});
