import fs from 'node:fs';

const submission = JSON.parse(
  fs.readFileSync('chatgpt-app-submission.template.json', 'utf8'),
) as {
  $schema: string;
  tools: Record<
    string,
    {
      annotations: {
        readOnlyHint: boolean;
        openWorldHint: boolean;
        destructiveHint: boolean;
      };
    }
  >;
  test_cases: Array<{
    expected_output: string | null;
    tools_triggered: string;
    user_prompt: string;
  }>;
};

describe('ChatGPT app submission artifact', () => {
  it('keeps reviewer fixture IDs only in the materialized portal export', () => {
    expect(submission.$schema).toBe(
      'https://developers.openai.com/plugins/schemas/chatgpt-app-submission.v1.json',
    );

    const placeholders = submission.test_cases.flatMap(({ user_prompt }) =>
      [...user_prompt.matchAll(/<PORTAL_[A-Z_]+>/g)].map(([placeholder]) => placeholder),
    );

    expect([...new Set(placeholders)].sort()).toEqual([
      '<PORTAL_AGENT_ID>',
      '<PORTAL_COMPLETED_RUN_ID>',
      '<PORTAL_METRIC_ID>',
      '<PORTAL_PERSONA_ID>',
      '<PORTAL_REPORT_ID>',
      '<PORTAL_RUN_TEMPLATE_ID>',
      '<PORTAL_SCHEDULE_ID>',
      '<PORTAL_TEST_SET_ID>',
    ]);
  });

  it('keeps the positive review workflows within the portal limit', () => {
    expect(submission.test_cases).toHaveLength(5);
  });

  it('documents a concrete expected result for every positive workflow', () => {
    for (const testCase of submission.test_cases) {
      expect(testCase.expected_output?.trim()).toBeTruthy();
    }
  });

  it('declares the full production MCP tool catalog', () => {
    expect(Object.keys(submission.tools).sort()).toEqual([
      'consult_sofia',
      'create_agent',
      'create_report',
      'create_run',
      'create_scheduled_run',
      'create_test_case',
      'create_test_set',
      'get_agent',
      'get_metric',
      'get_persona',
      'get_report',
      'get_run',
      'get_scheduled_run',
      'get_test_case',
      'get_test_set',
      'list_agents',
      'list_metrics',
      'list_personas',
      'list_reports',
      'list_run_templates',
      'list_runs',
      'list_scheduled_runs',
      'list_test_cases',
      'list_test_sets',
      'update_agent',
      'update_scheduled_run',
      'update_test_case',
    ]);
  });

  it('preserves the risk annotations for report and scheduling writes', () => {
    expect(submission.tools.create_report.annotations).toEqual({
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    });
    for (const toolName of ['create_scheduled_run', 'update_scheduled_run']) {
      expect(submission.tools[toolName].annotations).toEqual({
        readOnlyHint: false,
        openWorldHint: true,
        destructiveHint: true,
      });
    }
  });

  it('includes independent report and scheduling reviewer workflows', () => {
    const reviewTools = new Set(
      submission.test_cases.flatMap(({ tools_triggered }) =>
        tools_triggered.split(', ').filter(Boolean),
      ),
    );

    for (const toolName of [
      'list_reports',
      'get_report',
      'create_report',
      'list_run_templates',
      'list_scheduled_runs',
      'get_scheduled_run',
      'create_scheduled_run',
      'update_scheduled_run',
    ]) {
      expect(reviewTools.has(toolName)).toBe(true);
    }
  });
});
