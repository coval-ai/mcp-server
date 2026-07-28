import {
  CreateAgentInputSchema,
  CreateRunInputSchema,
  CreateTestCaseInputSchema,
  CreateTestSetInputSchema,
  UpdateAgentInputSchema,
  UpdateTestCaseInputSchema,
} from '../../src/schemas/index.js';

describe('public write input schemas', () => {
  it('advertises create_agent as an MCP-serializable object with bounded connection fields', () => {
    expect(
      CreateAgentInputSchema.safeParse({
        display_name: 'Reviewer voice agent',
        model_type: 'MODEL_TYPE_VOICE',
      }).success,
    ).toBe(true);
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
    ).toBe(true);
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
