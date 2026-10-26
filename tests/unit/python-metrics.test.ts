import { jest } from '@jest/globals';
import { CovalApiClient } from '../../src/client.js';
import {
  CancelPythonMetricPreviewInputSchema,
  CreatePythonMetricDraftInputSchema,
  CreatePythonMetricPreviewInputSchema,
  GetPythonMetricDraftInputSchema,
  GetPythonMetricPreviewInputSchema,
  PublishPythonMetricDraftInputSchema,
} from '../../src/schemas/python-metrics.js';

describe('Python metric draft schemas', () => {
  it('validates draft fields, nullable identifiers, and bounded requirements', () => {
    expect(
      CreatePythonMetricDraftInputSchema.safeParse({
        target_metric_id: null,
        target_version_id: null,
        display_name: 'Metric',
        description: '',
        source: 'def evaluate(conversation): return True',
        output_type: 'boolean',
        unit: null,
        requirements: {
          audio: false,
          traces: true,
          frame_tables: ['turns'],
        },
      }).success,
    ).toBe(true);
    for (const input of [
      { display_name: '', source: 'return 1', output_type: 'number' },
      { display_name: 'Metric', source: '', output_type: 'number' },
      { display_name: 'Metric', source: 'return 1', output_type: 'string' },
      {
        display_name: 'Metric',
        source: 'return 1',
        output_type: 'number',
        unknown: true,
      },
      {
        display_name: 'Metric',
        source: 'return 1',
        output_type: 'number',
        requirements: { unknown: true },
      },
      { display_name: 'x'.repeat(201), source: 'return 1', output_type: 'number' },
      { display_name: 'Metric', source: 'x'.repeat(65_537), output_type: 'number' },
      { display_name: 'Metric', source: 'return 1', output_type: 'number', unit: 'x'.repeat(65) },
    ]) {
      expect(CreatePythonMetricDraftInputSchema.safeParse(input).success).toBe(false);
    }
    expect(
      CreatePythonMetricDraftInputSchema.safeParse({
        display_name: 'Metric',
        source: 'return 1',
        output_type: 'number',
        requirements: { frame_tables: Array.from({ length: 33 }, () => 'turns') },
      }).success,
    ).toBe(false);
  });

  it('validates identifiers, exactly one preview output, and publish evidence', () => {
    expect(GetPythonMetricDraftInputSchema.safeParse({ draft_id: 'draft-1' }).success).toBe(true);
    expect(GetPythonMetricDraftInputSchema.safeParse({ draft_id: '' }).success).toBe(false);
    expect(
      CreatePythonMetricPreviewInputSchema.safeParse({
        draft_id: 'draft-1',
        simulation_output_ids: ['output-1'],
      }).success,
    ).toBe(true);
    expect(
      CreatePythonMetricPreviewInputSchema.safeParse({
        draft_id: 'draft-1',
        simulation_output_ids: [],
      }).success,
    ).toBe(false);
    expect(
      CreatePythonMetricPreviewInputSchema.safeParse({
        draft_id: 'draft-1',
        simulation_output_ids: ['output-1', 'output-2'],
      }).success,
    ).toBe(false);
    expect(
      GetPythonMetricPreviewInputSchema.safeParse({
        draft_id: 'draft-1',
        preview_id: 'preview-1',
      }).success,
    ).toBe(true);
    expect(
      CancelPythonMetricPreviewInputSchema.safeParse({
        draft_id: 'draft-1',
        preview_id: 'preview-1',
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      PublishPythonMetricDraftInputSchema.safeParse({
        draft_id: 'draft-1',
        preview_ids: ['preview-1'],
        fingerprint: 'a'.repeat(64),
      }).success,
    ).toBe(true);
    for (const input of [
      { draft_id: 'draft-1', preview_ids: [], fingerprint: 'a'.repeat(64) },
      { draft_id: 'draft-1', preview_ids: ['preview-1'], fingerprint: 'a'.repeat(63) },
      { draft_id: 'draft-1', preview_ids: ['preview-1'], fingerprint: 'A'.repeat(64) },
      {
        draft_id: 'draft-1',
        preview_ids: Array.from({ length: 11 }, (_, index) => `preview-${index}`),
        fingerprint: 'a'.repeat(64),
      },
    ]) {
      expect(PublishPythonMetricDraftInputSchema.safeParse(input).success).toBe(false);
    }
  });
});

describe('Python metric draft client methods', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends each API method, path, and request body', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    const client = new CovalApiClient('test-key', 'https://api.example.com/v1');
    const fingerprint = 'a'.repeat(64);
    const cases: Array<{
      call: () => Promise<unknown>;
      method: string;
      path: string;
      body?: unknown;
    }> = [
      {
        call: () =>
          client.createPythonMetricDraft({
            display_name: 'Metric',
            source: 'return True',
            output_type: 'boolean',
            target_metric_id: null,
            target_version_id: 'version-1',
            description: 'Description',
            unit: null,
            requirements: { audio: false, traces: true, frame_tables: ['turns'] },
          }),
        method: 'POST',
        path: '/v1/python-metric-drafts',
        body: {
          display_name: 'Metric',
          source: 'return True',
          output_type: 'boolean',
          target_metric_id: null,
          target_version_id: 'version-1',
          description: 'Description',
          unit: null,
          requirements: { audio: false, traces: true, frame_tables: ['turns'] },
        },
      },
      {
        call: () => client.getPythonMetricDraft('draft-1'),
        method: 'GET',
        path: '/v1/python-metric-drafts/draft-1',
      },
      {
        call: () =>
          client.createPythonMetricPreview('draft-1', {
            simulation_output_ids: ['output-1'],
          }),
        method: 'POST',
        path: '/v1/python-metric-drafts/draft-1/previews',
        body: { simulation_output_ids: ['output-1'] },
      },
      {
        call: () => client.getPythonMetricPreview('draft-1', 'preview-1'),
        method: 'GET',
        path: '/v1/python-metric-drafts/draft-1/previews/preview-1',
      },
      {
        call: () => client.cancelPythonMetricPreview('draft-1', 'preview-1'),
        method: 'POST',
        path: '/v1/python-metric-drafts/draft-1/previews/preview-1/cancel',
      },
      {
        call: () =>
          client.publishPythonMetricDraft('draft-1', {
            preview_ids: ['preview-1'],
            fingerprint,
          }),
        method: 'POST',
        path: '/v1/python-metric-drafts/draft-1/publish',
        body: { preview_ids: ['preview-1'], fingerprint },
      },
    ];

    for (const testCase of cases) {
      fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));
      await testCase.call();
      const [url, init] = fetchMock.mock.calls.at(-1)!;
      expect(new URL(String(url)).pathname).toBe(testCase.path);
      expect(init?.method).toBe(testCase.method);
      expect(init?.headers).toMatchObject({ 'X-API-Key': 'test-key' });
      expect(init?.body).toBe(
        testCase.body === undefined ? undefined : JSON.stringify(testCase.body),
      );
    }
  });
});
