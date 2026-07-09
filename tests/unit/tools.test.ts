import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../../src/client.js';
import { registerAllTools } from '../../src/tools/index.js';

describe('registerAllTools', () => {
  it('registers consult_covi for the local stdio server by default', () => {
    const toolNames: string[] = [];
    const server = {
      tool: (name: string) => toolNames.push(name)
    } as unknown as McpServer;

    registerAllTools(server, new CovalApiClient('customer-api-key'));

    expect(toolNames).toContain('consult_covi');
  });
});
