import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../../src/client.js';
import type { ToolAnnotationProfile } from '../../src/tools/annotations.js';
import { registerAllTools } from '../../src/tools/index.js';

interface ToolRegistration {
  title?: string;
  description?: string;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

function collectRegistrations(annotationProfile?: ToolAnnotationProfile) {
  const toolNames: string[] = [];
  const registrations = new Map<string, ToolRegistration>();
  const server = {
    registerTool: (name: string, config: ToolRegistration) => {
      toolNames.push(name);
      registrations.set(name, config);
    },
  } as unknown as McpServer;

  registerAllTools(server, new CovalApiClient('customer-api-key'), {
    annotationProfile,
  });
  return { registrations, toolNames };
}

describe('registerAllTools', () => {
  it('defaults unspecified callers such as stdio to standard annotations', () => {
    const { registrations } = collectRegistrations();

    expect(registrations.get('create_agent')?.annotations?.destructiveHint).toBe(false);
    expect(registrations.get('create_test_set')?.annotations?.destructiveHint).toBe(false);
    expect(registrations.get('create_test_case')?.annotations?.destructiveHint).toBe(false);
    expect(registrations.get('create_run')?.annotations?.destructiveHint).toBe(true);
  });

  it.each(['standard', 'claude'] as const)(
    'keeps %s tool descriptions self-contained',
    (annotationProfile) => {
      const { registrations } = collectRegistrations(annotationProfile);
      const externalSource = /https?:\/\//i;
      const otherToolName = /\b(?:list|get|create|update|consult)_[a-z_]+\b/i;

      for (const registration of registrations.values()) {
        expect(registration.description).toEqual(expect.any(String));
        expect(registration.description).not.toMatch(externalSource);
        expect(registration.description).not.toMatch(otherToolName);
      }
    }
  );

  it.each([
    ['standard', false],
    ['claude', true],
  ] as const)(
    'registers complete %s directory metadata for every tool',
    (annotationProfile, additiveCreatesAreDestructive) => {
      const { registrations, toolNames } = collectRegistrations(annotationProfile);
      const readOnlyAnnotations = {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      };
      const additiveWriteAnnotations = {
        readOnlyHint: false,
        destructiveHint: additiveCreatesAreDestructive,
        idempotentHint: false,
        openWorldHint: false,
      };
      const destructiveWriteAnnotations = {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      };
      const expectedAnnotations = new Map([
        ['list_runs', readOnlyAnnotations],
        ['get_run', readOnlyAnnotations],
        ['create_run', { ...destructiveWriteAnnotations, openWorldHint: true }],
        ['list_agents', readOnlyAnnotations],
        ['get_agent', readOnlyAnnotations],
        ['create_agent', additiveWriteAnnotations],
        ['update_agent', destructiveWriteAnnotations],
        ['list_test_sets', readOnlyAnnotations],
        ['get_test_set', readOnlyAnnotations],
        ['create_test_set', additiveWriteAnnotations],
        ['list_test_cases', readOnlyAnnotations],
        ['get_test_case', readOnlyAnnotations],
        ['create_test_case', additiveWriteAnnotations],
        ['update_test_case', destructiveWriteAnnotations],
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
    },
  );
});
