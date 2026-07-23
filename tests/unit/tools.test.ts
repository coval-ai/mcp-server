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
        annotations?: {
          title?: string;
          readOnlyHint?: boolean;
          destructiveHint?: boolean;
          idempotentHint?: boolean;
          openWorldHint?: boolean;
        };
      }
    >();
    const server = {
      registerTool: (
        name: string,
        config: {
          title?: string;
          annotations?: {
            title?: string;
            readOnlyHint?: boolean;
            destructiveHint?: boolean;
            idempotentHint?: boolean;
            openWorldHint?: boolean;
          };
        }
      ) => {
        toolNames.push(name);
        registrations.set(name, config);
      }
    } as unknown as McpServer;

    registerAllTools(server, new CovalApiClient('customer-api-key'));

    const readOnlyAnnotations = {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    };
    const writeAnnotations = {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    };
    const expectedAnnotations = new Map([
      ['list_runs', readOnlyAnnotations],
      ['get_run', readOnlyAnnotations],
      ['create_run', { ...writeAnnotations, openWorldHint: true }],
      ['list_agents', readOnlyAnnotations],
      ['get_agent', readOnlyAnnotations],
      ['create_agent', writeAnnotations],
      ['update_agent', writeAnnotations],
      ['list_test_sets', readOnlyAnnotations],
      ['get_test_set', readOnlyAnnotations],
      ['create_test_set', writeAnnotations],
      ['list_test_cases', readOnlyAnnotations],
      ['get_test_case', readOnlyAnnotations],
      ['create_test_case', writeAnnotations],
      ['update_test_case', writeAnnotations],
      ['list_metrics', readOnlyAnnotations],
      ['get_metric', readOnlyAnnotations],
      ['list_personas', readOnlyAnnotations],
      ['get_persona', readOnlyAnnotations],
      ['consult_sofia', readOnlyAnnotations],
    ]);

    expect([...toolNames].sort()).toEqual([...expectedAnnotations.keys()].sort());
    expect(toolNames).toHaveLength(19);

    for (const [name, expected] of expectedAnnotations) {
      const registration = registrations.get(name);
      expect(registration).toBeDefined();
      expect(registration?.annotations).toMatchObject(expected);
      expect(registration?.title).toEqual(expect.any(String));
      expect(registration?.annotations?.title).toEqual(expect.any(String));
      expect(registration?.annotations?.title).toBe(registration?.title);
    }
  });
});
