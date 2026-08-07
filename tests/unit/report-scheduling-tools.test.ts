import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { jest } from '@jest/globals';
import { CovalApiClient } from '../../src/client.js';
import { registerReportTools } from '../../src/tools/reports.js';
import { registerSchedulingTools } from '../../src/tools/scheduling.js';

type ToolHandler = (params: Record<string, unknown>) => Promise<CallToolResult>;

function responsePayload(result: CallToolResult): Record<string, unknown> {
  const content = result.content[0];
  if (content?.type !== 'text') throw new Error('Expected a text tool response');
  return JSON.parse(content.text) as Record<string, unknown>;
}

function collectHandlers(
  register: (server: McpServer, client: CovalApiClient) => void,
  client: CovalApiClient,
) {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool: (
      name: string,
      _config: unknown,
      handler: ToolHandler,
    ) => handlers.set(name, handler),
  } as unknown as McpServer;
  register(server, client);
  return handlers;
}

describe('report tools', () => {
  it('returns bounded rows with explicit scope information', async () => {
    const client = {
      getReport: jest.fn(async () => ({ report: { id: 'report_example' } })),
      listReportRows: jest.fn(async () => ({
        rows: [{ id: 'row_1' }],
        next_page_token: '20',
      })),
    } as unknown as CovalApiClient;
    const handlers = collectHandlers(registerReportTools, client);

    const result = await handlers.get('get_report')!({
      report_id: 'report_example',
      metric_ids: ['metric_example'],
    });

    expect(client.listReportRows).toHaveBeenCalledWith('report_example', {
      page_size: 20,
      page_token: undefined,
      metric_ids: ['metric_example'],
    });
    expect(responsePayload(result)).toEqual({
      report: { id: 'report_example' },
      rows: [{ id: 'row_1' }],
      next_page_token: '20',
      scope: { returned: 1, examined: 1, page_size: 20, has_more: true },
    });
  });

  it('fits pathological report content into a valid bounded response', async () => {
    const largeText = 'untrusted-content '.repeat(2_000);
    const rawRows = Array.from({ length: 20 }, (_, index) => ({
      simulation_id: `simulation_${index}`,
      run_id: 'run_example',
      metadata: { largeText },
      metrics: [{ metric_id: 'metric_example', value: largeText }],
    }));
    const client = {
      getReport: jest.fn(async () => ({
        report: { id: 'report_example', description: largeText },
      })),
      listReportRows: jest.fn(async () => ({
        rows: rawRows,
        next_page_token: '25',
      })),
    } as unknown as CovalApiClient;
    const handlers = collectHandlers(registerReportTools, client);

    const result = await handlers.get('get_report')!({
      report_id: 'report_example',
      page_size: 20,
      page_token: '5',
    });
    const content = result.content[0];
    if (content?.type !== 'text') throw new Error('Expected a text tool response');
    const payload = JSON.parse(content.text) as {
      rows: unknown[];
      next_page_token: string;
      output_truncated: boolean;
      scope: { examined: number; returned: number; has_more: boolean };
    };

    expect(content.text.length).toBeLessThanOrEqual(11_000);
    expect(payload.output_truncated).toBe(true);
    expect(payload.scope.examined).toBe(20);
    expect(payload.scope.returned).toBeLessThanOrEqual(20);
    expect(payload.scope.has_more).toBe(true);
    expect(payload.next_page_token).toBe('25');
  });

  it('omits oversized nested metric structures without exceeding the hard budget', async () => {
    const nestedMetricValue = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [
        `field_${index}`,
        Array.from({ length: 10 }, () => 'nested-value '.repeat(100)),
      ]),
    );
    const client = {
      getReport: jest.fn(async () => ({ report: { id: 'report_example' } })),
      listReportRows: jest.fn(async () => ({
        rows: [
          {
            simulation_id: 'simulation_example',
            run_id: 'run_example',
            metrics: [
              {
                metric_id: 'metric_example',
                value: nestedMetricValue,
              },
            ],
          },
        ],
      })),
    } as unknown as CovalApiClient;
    const handlers = collectHandlers(registerReportTools, client);

    const result = await handlers.get('get_report')!({
      report_id: 'report_example',
      page_size: 1,
    });
    const content = result.content[0];
    if (content?.type !== 'text') throw new Error('Expected a text tool response');
    const payload = JSON.parse(content.text) as {
      output_truncated: boolean;
    };

    expect(content.text.length).toBeLessThanOrEqual(11_000);
    expect(payload.output_truncated).toBe(true);
  });

  it('forces every created report to remain private', async () => {
    const createReport = jest.fn(async (payload: unknown) => ({
      report: { id: 'report_example', payload },
    }));
    const client = { createReport } as unknown as CovalApiClient;
    const handlers = collectHandlers(registerReportTools, client);

    await handlers.get('create_report')!({
      name: 'Regression summary',
      run_ids: ['run_example'],
      compare_by: 'run',
    });

    expect(createReport).toHaveBeenCalledWith({
      name: 'Regression summary',
      run_ids: ['run_example'],
      compare_by: 'run',
      permissions: 'PRIVATE',
    });
  });
});

describe('scheduling tools', () => {
  it('creates schedules disabled unless activation is explicit', async () => {
    const createScheduledRun = jest.fn(async (payload: unknown) => ({
      scheduled_run: { id: 'schedule_example', payload },
    }));
    const client = { createScheduledRun } as unknown as CovalApiClient;
    const handlers = collectHandlers(registerSchedulingTools, client);
    const input = {
      display_name: 'Nightly regression',
      run_template_id: 'template_example',
      schedule_expression: 'rate(1 day)',
    };

    await handlers.get('create_scheduled_run')!(input);
    await handlers.get('create_scheduled_run')!({ ...input, enabled: true });

    expect(createScheduledRun).toHaveBeenNthCalledWith(1, {
      ...input,
      enabled: false,
    });
    expect(createScheduledRun).toHaveBeenNthCalledWith(2, {
      ...input,
      enabled: true,
    });
  });

  it('passes history bounds and exposes its continuation token', async () => {
    const runs = Array.from({ length: 10 }, (_, index) => ({ id: `run_${index + 10}` }));
    const listScheduledRunHistory = jest.fn(async () => ({
      runs,
      next_page_token: '20',
      available_in_api_window: 25,
      upstream_capped: false,
    }));
    const client = {
      getScheduledRun: jest.fn(async () => ({
        scheduled_run: { id: 'schedule_example' },
      })),
      listScheduledRunHistory,
    } as unknown as CovalApiClient;
    const handlers = collectHandlers(registerSchedulingTools, client);

    const result = await handlers.get('get_scheduled_run')!({
      scheduled_run_id: 'schedule_example',
      history_size: 10,
      history_page_token: '10',
    });
    const payload = responsePayload(result);

    expect(listScheduledRunHistory).toHaveBeenCalledWith('schedule_example', {
      page_size: 10,
      page_token: '10',
    });
    expect(payload.runs).toEqual(runs);
    expect(payload.next_history_page_token).toBe('20');
    expect(payload.history_scope).toEqual({
      returned: 10,
      available_in_api_window: 25,
      has_more: true,
      upstream_capped: false,
    });
  });

  it('marks completeness unknown when the API history window is exhausted at its cap', async () => {
    const client = {
      getScheduledRun: jest.fn(async () => ({
        scheduled_run: { id: 'schedule_example' },
      })),
      listScheduledRunHistory: jest.fn(async () => ({
        runs: [{ id: 'run_499' }],
        next_page_token: undefined,
        available_in_api_window: 500,
        upstream_capped: true,
      })),
    } as unknown as CovalApiClient;
    const handlers = collectHandlers(registerSchedulingTools, client);

    const result = await handlers.get('get_scheduled_run')!({
      scheduled_run_id: 'schedule_example',
      history_page_token: '499',
    });
    const payload = responsePayload(result);

    expect(payload.next_history_page_token).toBeUndefined();
    expect(payload.history_scope).toMatchObject({
      has_more: null,
      upstream_capped: true,
    });
    expect(payload.note).toContain('capped at 500 recent runs');
  });
});
