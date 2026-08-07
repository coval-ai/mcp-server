import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, type ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { CovalApiClient } from '../../src/client.js';
import type {
  ToolAnnotationProfile,
  ToolInputProfile,
} from '../../src/tools/annotations.js';
import { registerAllTools } from '../../src/tools/index.js';
import {
  collectJsonSchemaProperties,
  collectTopLevelJsonSchemaProperties,
  findOpenAdditionalProperties,
} from './helpers/json-schema.js';

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
  inputSchema?: unknown;
}

function collectRegistrations(
  annotationProfile?: ToolAnnotationProfile,
  inputProfile?: ToolInputProfile,
) {
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
    inputProfile,
  });
  return { registrations, toolNames };
}

describe('registerAllTools', () => {
  it('defaults unspecified callers such as stdio to standard annotations', () => {
    const { registrations } = collectRegistrations();

    expect(registrations.get('create_agent')?.annotations?.destructiveHint).toBe(false);
    expect(registrations.get('create_test_set')?.annotations?.destructiveHint).toBe(false);
    expect(registrations.get('create_test_case')?.annotations?.destructiveHint).toBe(false);
    expect(registrations.get('create_report')?.annotations?.destructiveHint).toBe(false);
    expect(registrations.get('create_run')?.annotations?.destructiveHint).toBe(true);
    expect(registrations.get('create_scheduled_run')?.annotations?.destructiveHint).toBe(true);
  });

  it('exposes only bounded, task-specific input fields', () => {
    const { registrations } = collectRegistrations('standard', 'openai');
    const expectedFields = new Map<string, string[]>([
      ['list_runs', ['filter', 'order_by', 'page_size', 'page_token']],
      ['get_run', ['run_id']],
      [
        'create_run',
        ['agent_id', 'metric_ids', 'options', 'persona_id', 'tags', 'test_set_id'],
      ],
      ['list_agents', ['filter', 'order_by', 'page_size', 'page_token']],
      ['get_agent', ['agent_id']],
      [
        'create_agent',
        ['display_name', 'endpoint', 'model_type', 'phone_number', 'prompt'],
      ],
      [
        'update_agent',
        [
          'agent_id',
          'chat_endpoint',
          'display_name',
          'outbound_voice_endpoint',
          'phone_number',
          'prompt',
          'websocket_endpoint',
        ],
      ],
      ['list_test_sets', ['filter', 'order_by', 'page_size', 'page_token']],
      ['get_test_set', ['test_set_id']],
      ['create_test_set', ['description', 'display_name', 'test_set_type']],
      [
        'list_test_cases',
        ['order_by', 'page_size', 'page_token', 'test_set_id'],
      ],
      ['get_test_case', ['test_case_id']],
      [
        'create_test_case',
        ['description', 'expected_behaviors', 'input_str', 'test_set_id'],
      ],
      [
        'update_test_case',
        ['description', 'expected_behaviors', 'input_str', 'test_case_id'],
      ],
      [
        'list_metrics',
        ['filter', 'include_builtin', 'order_by', 'page_size', 'page_token'],
      ],
      ['get_metric', ['metric_id']],
      ['list_personas', ['filter', 'order_by', 'page_size', 'page_token']],
      ['get_persona', ['persona_id']],
      ['list_reports', ['page_size', 'page_token']],
      ['get_report', ['metric_ids', 'page_size', 'page_token', 'report_id']],
      [
        'create_report',
        ['compare_by', 'metadata_key', 'name', 'run_ids', 'view_mode'],
      ],
      ['list_run_templates', ['page_size', 'page_token']],
      [
        'list_scheduled_runs',
        ['enabled', 'page_size', 'page_token', 'template_id'],
      ],
      ['get_scheduled_run', ['history_size', 'scheduled_run_id']],
      [
        'create_scheduled_run',
        [
          'display_name',
          'enabled',
          'run_template_id',
          'schedule_expression',
          'schedule_timezone',
        ],
      ],
      [
        'update_scheduled_run',
        [
          'display_name',
          'enabled',
          'run_template_id',
          'schedule_expression',
          'schedule_timezone',
          'scheduled_run_id',
        ],
      ],
      ['consult_sofia', ['prompt']],
    ]);
    const forbiddenFields = new Set([
      'conversation',
      'history',
      'messages',
      'metadata',
      'metric_input',
      'parameters',
      'session_id',
      'simulation_metadata_input',
      'test_set_metadata',
      'user_notes',
    ]);

    expect([...registrations.keys()].sort()).toEqual(
      [...expectedFields.keys()].sort(),
    );

    for (const [toolName, registration] of registrations) {
      expect(registration.inputSchema).toBeDefined();
      const inputSchema = registration.inputSchema as ZodTypeAny;
      expect(inputSchema).toBeInstanceOf(z.ZodType);
      const jsonSchema = zodToJsonSchema(inputSchema, {
        target: 'jsonSchema7',
      }) as Record<string, unknown>;
      const properties = collectTopLevelJsonSchemaProperties(jsonSchema);
      const allProperties = collectJsonSchemaProperties(jsonSchema);

      expect([...properties].sort()).toEqual(
        [...expectedFields.get(toolName)!].sort(),
      );
      expect(
        [...allProperties].filter((field) => forbiddenFields.has(field)),
      ).toEqual([]);
      expect(findOpenAdditionalProperties(jsonSchema)).toEqual([]);
    }
  });

  it('keeps legacy Claude and stdio input fields available', () => {
    const { registrations } = collectRegistrations();
    const fieldsFor = (toolName: string) => {
      const inputSchema = registrations.get(toolName)?.inputSchema as ZodTypeAny;
      return collectTopLevelJsonSchemaProperties(
        zodToJsonSchema(inputSchema, { target: 'jsonSchema7' }),
      );
    };

    expect([...fieldsFor('create_agent')]).toContain('metadata');
    expect([...fieldsFor('update_agent')]).toContain('metadata');
    expect([...fieldsFor('create_run')]).toContain('metadata');
    expect([...fieldsFor('create_test_set')]).toEqual(
      expect.arrayContaining(['slug', 'test_set_metadata', 'parameters']),
    );
    expect([...fieldsFor('create_test_case')]).toEqual(
      expect.arrayContaining([
        'simulation_metadata_input',
        'metric_input',
        'user_notes',
      ]),
    );
    expect([...fieldsFor('consult_sofia')]).toEqual(
      expect.arrayContaining(['conversation', 'session_id']),
    );
  });

  it('keeps OpenAI pagination and test-set IDs strict without narrowing legacy inputs', () => {
    const openAi = collectRegistrations('standard', 'openai').registrations;
    const legacy = collectRegistrations('claude', 'legacy').registrations;
    const schemaFor = (registrations: Map<string, ToolRegistration>, toolName: string) =>
      registrations.get(toolName)?.inputSchema as ZodTypeAny;

    expect(
      schemaFor(openAi, 'list_test_sets').safeParse({
        page_size: 10,
        legacy_extension: 'ignored',
      }).success,
    ).toBe(false);
    expect(
      schemaFor(legacy, 'list_test_sets').safeParse({
        page_size: 10,
        legacy_extension: 'ignored',
      }),
    ).toMatchObject({
      success: true,
      data: { page_size: 10 },
    });
    expect(
      schemaFor(openAi, 'get_test_set').safeParse({
        test_set_id: 'test_set_example',
      }).success,
    ).toBe(false);
    expect(
      schemaFor(legacy, 'get_test_set').safeParse({
        test_set_id: 'test_set_example',
      }).success,
    ).toBe(true);
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
        ['list_reports', readOnlyAnnotations],
        ['get_report', readOnlyAnnotations],
        ['create_report', additiveWriteAnnotations],
        ['list_run_templates', readOnlyAnnotations],
        ['list_scheduled_runs', readOnlyAnnotations],
        ['get_scheduled_run', readOnlyAnnotations],
        [
          'create_scheduled_run',
          { ...destructiveWriteAnnotations, openWorldHint: true },
        ],
        [
          'update_scheduled_run',
          { ...destructiveWriteAnnotations, openWorldHint: true },
        ],
        ['consult_sofia', readOnlyAnnotations],
      ]);

      expect([...toolNames].sort()).toEqual([...expectedAnnotations.keys()].sort());
      expect(toolNames).toHaveLength(27);

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
