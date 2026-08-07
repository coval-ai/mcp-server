import fs from 'node:fs';

const submission = JSON.parse(
  fs.readFileSync('chatgpt-app-submission.json', 'utf8'),
) as {
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
  test_cases: Array<{ tools_triggered: string }>;
};

describe('ChatGPT app submission artifact', () => {
  it('keeps the positive review workflows within the portal limit', () => {
    expect(submission.test_cases).toHaveLength(5);
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
