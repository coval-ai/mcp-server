import { jest } from '@jest/globals';
import { CovalApiClient } from '../../src/client.js';

describe('CovalApiClient report and scheduling resources', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps report pagination to the report API and normalizes its cursor', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ reports: [{ id: 'report_1' }], next_cursor: '40' }),
        { status: 200 },
      ),
    );
    const client = new CovalApiClient('customer-api-key', 'https://api.example.com/v1');

    await expect(
      client.listReports({ page_size: 20, page_token: '20' }),
    ).resolves.toEqual({
      reports: [{ id: 'report_1' }],
      next_page_token: '40',
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.example.com/v1/reports?limit=20&cursor=20',
    );
  });

  it('passes bounded report row filters as query parameters', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ rows: [], next_page_token: null }), {
        status: 200,
      }),
    );
    const client = new CovalApiClient('customer-api-key', 'https://api.example.com/v1');

    await client.listReportRows('report_example', {
      page_size: 20,
      page_token: '40',
      metric_ids: ['metric_1', 'metric_2'],
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.example.com/v1/reports/report_example/rows?limit=20&cursor=40&metric_ids=metric_1%2Cmetric_2',
    );
  });

  it('uses the dedicated schedule endpoints and preserves boolean filters', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ scheduled_runs: [] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ scheduled_run: { id: 'schedule_1' } }), {
          status: 201,
        }),
      );
    const client = new CovalApiClient('customer-api-key', 'https://api.example.com/v1');

    await client.listScheduledRuns({
      page_size: 10,
      enabled: false,
      template_id: 'template_1',
    });
    await client.createScheduledRun({
      display_name: 'Disabled regression',
      run_template_id: 'template_1',
      schedule_expression: 'rate(1 day)',
      enabled: false,
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.example.com/v1/scheduled-runs?page_size=10&enabled=false&template_id=template_1',
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.example.com/v1/scheduled-runs',
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      display_name: 'Disabled regression',
      run_template_id: 'template_1',
      schedule_expression: 'rate(1 day)',
      enabled: false,
    });
  });
});
