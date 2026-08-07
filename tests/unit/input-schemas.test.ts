import {
  CreateAgentInputSchema,
  CreateRunInputSchema,
  CreateReportInputSchema,
  CreateScheduledRunInputSchema,
  CreateTestCaseInputSchema,
  CreateTestSetInputSchema,
  GetScheduledRunInputSchema,
  GetTestSetInputSchema,
  LegacyGetTestSetInputSchema,
  ListTestCasesInputSchema,
  PaginationInputSchema,
  ResourceIdSchema,
  StrictPaginationInputSchema,
  UpdateAgentInputSchema,
  UpdateScheduledRunInputSchema,
  UpdateTestCaseInputSchema,
} from '../../src/schemas/index.js';

describe('shared public input boundaries', () => {
  it('accepts safe resource IDs and rejects path or query delimiters', () => {
    expect(ResourceIdSchema.safeParse('agent_Example-123').success).toBe(true);
    for (const unsafeId of ['../agents', 'agent/id', 'agent?id', 'agent#fragment']) {
      expect(ResourceIdSchema.safeParse(unsafeId).success).toBe(false);
    }
  });

  it('keeps OpenAI pagination strict and strips unknown legacy pagination keys', () => {
    const input = {
      page_size: 10,
      legacy_extension: 'ignored',
    };
    const result = PaginationInputSchema.safeParse(input);

    expect(StrictPaginationInputSchema.safeParse(input).success).toBe(false);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ page_size: 10 });
    }
  });

  it('keeps eight-character test-set IDs specific to the OpenAI profile', () => {
    expect(GetTestSetInputSchema.safeParse({ test_set_id: 'Ab12Cd34' }).success).toBe(true);
    expect(
      GetTestSetInputSchema.safeParse({ test_set_id: 'test_set_example' }).success,
    ).toBe(false);
    expect(
      LegacyGetTestSetInputSchema.safeParse({ test_set_id: 'test_set_example' }).success,
    ).toBe(true);
  });

  it('rejects filter-breaking OpenAI test-set IDs', () => {
    expect(
      ListTestCasesInputSchema.safeParse({ test_set_id: 'Ab12Cd3"' }).success,
    ).toBe(false);
  });

  it('bounds scheduled-run history continuation tokens to the API window', () => {
    expect(
      GetScheduledRunInputSchema.safeParse({
        scheduled_run_id: 'schedule_example',
        history_page_token: '499',
      }).success,
    ).toBe(true);
    expect(
      GetScheduledRunInputSchema.safeParse({
        scheduled_run_id: 'schedule_example',
        history_page_token: '500',
      }).success,
    ).toBe(false);
  });
});

describe('public write input schemas', () => {
  it('keeps saved reports private and their grouping inputs internally consistent', () => {
    expect(
      CreateReportInputSchema.safeParse({
        name: 'Regression summary',
        run_ids: ['run_example'],
        compare_by: 'metadata',
      }).success,
    ).toBe(false);
    expect(
      CreateReportInputSchema.safeParse({
        name: 'Regression summary',
        run_ids: ['run_example'],
        compare_by: 'agent',
        metadata_key: 'environment',
      }).success,
    ).toBe(false);
    expect(
      CreateReportInputSchema.safeParse({
        name: 'Regression summary',
        run_ids: ['run_example'],
        permissions: 'PUBLIC',
      }).success,
    ).toBe(false);
    expect(
      CreateReportInputSchema.safeParse({
        name: 'Regression summary',
        run_ids: ['run_example'],
        compare_by: 'metadata',
        metadata_key: 'environment',
      }).success,
    ).toBe(true);
  });

  it('requires explicit cron timezones and at least one schedule update field', () => {
    expect(
      CreateScheduledRunInputSchema.safeParse({
        display_name: 'Weekday regression',
        run_template_id: 'template_example',
        schedule_expression: 'cron(0 9 ? * MON-FRI *)',
      }).success,
    ).toBe(false);
    expect(
      CreateScheduledRunInputSchema.safeParse({
        display_name: 'Weekday regression',
        run_template_id: 'template_example',
        schedule_expression: 'cron(0 9 ? * MON-FRI *)',
        schedule_timezone: 'America/Los_Angeles',
      }).success,
    ).toBe(true);
    expect(
      UpdateScheduledRunInputSchema.safeParse({
        scheduled_run_id: 'schedule_example',
      }).success,
    ).toBe(false);
    expect(
      UpdateScheduledRunInputSchema.safeParse({
        scheduled_run_id: 'schedule_example',
        schedule_expression: 'cron(0 9 ? * MON-FRI *)',
      }).success,
    ).toBe(false);
    expect(
      UpdateScheduledRunInputSchema.safeParse({
        scheduled_run_id: 'schedule_example',
        schedule_expression: 'cron(0 9 ? * MON-FRI *)',
        schedule_timezone: 'America/Los_Angeles',
      }).success,
    ).toBe(true);
    expect(
      UpdateScheduledRunInputSchema.safeParse({
        scheduled_run_id: 'schedule_example',
        enabled: false,
      }).success,
    ).toBe(true);
  });

  it('advertises create_agent as an MCP-serializable object with bounded connection fields', () => {
    expect(
      CreateAgentInputSchema.safeParse({
        display_name: 'Reviewer voice agent',
        model_type: 'MODEL_TYPE_VOICE',
      }).success,
    ).toBe(false);
    expect(
      CreateAgentInputSchema.safeParse({
        display_name: 'Reviewer voice agent',
        model_type: 'MODEL_TYPE_VOICE',
        phone_number: 'sip:reviewer@invalid.example',
      }).success,
    ).toBe(true);
    expect(
      CreateAgentInputSchema.safeParse({
        display_name: 'Reviewer chat agent',
        model_type: 'MODEL_TYPE_CHAT',
      }).success,
    ).toBe(false);
    expect(
      CreateAgentInputSchema.safeParse({
        display_name: 'Reviewer chat agent',
        model_type: 'MODEL_TYPE_CHAT',
        endpoint: 'https://chat.example.com/messages',
      }).success,
    ).toBe(true);
  });

  it.each([
    ['MODEL_TYPE_CHAT', 'not-a-url'],
    ['MODEL_TYPE_CHAT', 'ftp://chat.example.com/messages'],
    ['MODEL_TYPE_WEBSOCKET', 'not-a-url'],
    ['MODEL_TYPE_WEBSOCKET', 'ws://socket.example.com/messages'],
  ])('rejects malformed or unsupported %s endpoints without throwing', (modelType, endpoint) => {
    expect(() =>
      CreateAgentInputSchema.safeParse({
        display_name: 'Reviewer endpoint agent',
        model_type: modelType,
        endpoint,
      }),
    ).not.toThrow();
    expect(
      CreateAgentInputSchema.safeParse({
        display_name: 'Reviewer endpoint agent',
        model_type: modelType,
        endpoint,
      }).success,
    ).toBe(false);
  });

  it.each([
    ['create_agent', 'metadata', CreateAgentInputSchema],
    ['update_agent', 'metadata', UpdateAgentInputSchema],
    ['create_run', 'metadata', CreateRunInputSchema],
    ['create_test_set', 'test_set_metadata', CreateTestSetInputSchema],
    ['create_test_set', 'parameters', CreateTestSetInputSchema],
    ['create_test_case', 'simulation_metadata_input', CreateTestCaseInputSchema],
    ['create_test_case', 'metric_input', CreateTestCaseInputSchema],
    ['update_test_case', 'simulation_metadata_input', UpdateTestCaseInputSchema],
    ['update_test_case', 'metric_input', UpdateTestCaseInputSchema],
  ])('rejects broad %s.%s input', (_toolName, field, schema) => {
    const validInputs: Record<string, Record<string, unknown>> = {
      create_agent: {
        display_name: 'Reviewer voice agent',
        model_type: 'MODEL_TYPE_VOICE',
        phone_number: 'sip:reviewer@invalid.example',
      },
      update_agent: {
        agent_id: 'agent_example',
        display_name: 'Updated agent',
      },
      create_run: {
        agent_id: 'agent_example',
        persona_id: 'persona_example',
        test_set_id: 'test_set_example',
      },
      create_test_set: {
        display_name: 'Reviewer test set',
      },
      create_test_case: {
        test_set_id: 'Ab12Cd34',
        input_str: 'A synthetic evaluation scenario.',
      },
      update_test_case: {
        test_case_id: 'test_case_example',
        description: 'Updated description',
      },
    };

    expect(
      schema.safeParse({
        ...validInputs[_toolName],
        [field]: { arbitrary: { nested: true } },
      }).success,
    ).toBe(false);
  });
});
