import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../../src/client.js';
import { registerAllTools } from '../../src/tools/index.js';

describe('registerAllTools', () => {
  it('registers complete directory metadata for every tool', () => {
    const toolNames: string[] = [];
    const registrations = new Map<
      string,
      {
        title?: string;
        annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
      }
    >();
    const server = {
      registerTool: (
        name: string,
        config: {
          title?: string;
          annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
        }
      ) => {
        toolNames.push(name);
        registrations.set(name, config);
      }
    } as unknown as McpServer;

    registerAllTools(server, new CovalApiClient('customer-api-key'));

    expect(toolNames).toContain('consult_covi');
    expect(registrations.get('consult_covi')?.annotations?.readOnlyHint).toBe(true);
    expect(registrations.get('list_runs')?.annotations?.readOnlyHint).toBe(true);
    expect(registrations.get('create_run')?.annotations?.readOnlyHint).toBe(false);
    expect(registrations.get('create_run')?.annotations?.destructiveHint).toBe(false);
    expect(registrations.get('create_run')?.annotations?.openWorldHint).toBe(true);
    expect(registrations.get('update_agent')?.annotations?.destructiveHint).toBe(true);
    expect(registrations.get('update_test_case')?.annotations?.destructiveHint).toBe(true);
    expect(toolNames).toHaveLength(19);

    for (const name of toolNames) {
      const registration = registrations.get(name);
      expect(registration?.title).toBeTruthy();
      expect(typeof registration?.annotations?.readOnlyHint).toBe('boolean');
      expect(typeof registration?.annotations?.destructiveHint).toBe('boolean');
      expect(typeof registration?.annotations?.openWorldHint).toBe('boolean');
      if (name !== 'create_run') {
        expect(registration?.annotations?.openWorldHint).toBe(false);
      }
    }
  });
});
