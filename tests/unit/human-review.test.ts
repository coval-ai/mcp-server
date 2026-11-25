import { jest } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { CovalApiClient } from '../../src/client.js';
import { registerReviewTools } from '../../src/tools/human-review.js';

const upstream = jest.fn<typeof fetch>();
const input = {
  project_id: 'project_1',
  simulation_output_id: 'conversation_1',
  workspace_id: 'workspace_1',
};
const project = {
  id: input.project_id,
  display_name: 'Synthetic project',
  project_type: 'PROJECT_INDIVIDUAL',
  linked_simulation_count: 1,
  linked_simulation_ids: [input.simulation_output_id],
  linked_metric_ids: ['metric_1'],
  assignees: ['private-reviewer@example.invalid'],
};
const receipt = {
  review_annotation: {
    id: 'annotation_1',
    simulation_output_id: input.simulation_output_id,
    metric_id: 'metric_1',
    completion_status: 'COMPLETED',
    assignee: 'private-reviewer@example.invalid',
  },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function resultPayload(result: CallToolResult) {
  const content = result.content[0];
  if (content?.type !== 'text') throw new Error('Expected a text MCP result');
  return JSON.parse(content.text) as Record<string, unknown>;
}

function requestAt(index: number) {
  const [url, options] = upstream.mock.calls[index];
  return {
    url: new URL(String(url)),
    method: options?.method,
    headers: new Headers(options?.headers),
    body: typeof options?.body === 'string' ? JSON.parse(options.body) as unknown : undefined,
  };
}

describe('Human Review MCP workflow', () => {
  let mcp: Client;
  let originalFetch: typeof fetch;

  beforeEach(async () => {
    originalFetch = global.fetch;
    upstream.mockReset();
    global.fetch = upstream;
    const server = new McpServer({ name: 'test', version: '1' });
    registerReviewTools(server, new CovalApiClient('review-test-key', 'https://api.example.invalid/v1'));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    mcp = new Client({ name: 'review-client', version: '1' });
    await server.connect(serverTransport);
    await mcp.connect(clientTransport);
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    await mcp.close();
  });

  async function call(name: string, args: Record<string, unknown>) {
    return await mcp.callTool({ name, arguments: args }) as CallToolResult;
  }

  it('lists bounded project summaries and opens a linked conversation without scores or reviewer data', async () => {
    upstream
      .mockResolvedValueOnce(json({ review_projects: [project], next_page_token: 'next' }))
      .mockResolvedValueOnce(json({ review_project: project }))
      .mockResolvedValueOnce(json({ review_project: project }))
      .mockResolvedValueOnce(json({
        simulated_conversation: {
          conversation_id: input.simulation_output_id,
          status: 'COMPLETED',
          metric_values: { metric_1: 1 },
          transcript: [
            { role: 'system', content: 'private instructions' },
            { role: 'persona', content: 'Can I renew online?' },
            { role: 'agent', content: 'Yes.', hidden: 'internal trace' },
          ],
        },
      }));
    const list = await call('list_review_projects', { workspace_id: input.workspace_id });
    expect(resultPayload(list)).toEqual({
      review_projects: [{ id: project.id, display_name: project.display_name,
        project_type: project.project_type, linked_simulation_count: 1 }],
      next_page_token: 'next',
    });
    expect(requestAt(0).url.searchParams.get('page_size')).toBe('15');
    const details = await call('get_review_project', { project_id: project.id, workspace_id: input.workspace_id });
    expect(resultPayload(details)).toMatchObject({
      review_project: { linked_simulation_ids: ['conversation_1'], linked_metric_ids: ['metric_1'] },
      next_conversation_offset: null,
    });
    expect(JSON.stringify(details)).not.toContain('private-reviewer');
    const transcript = await call('get_review_conversation', input);
    expect(resultPayload(transcript)).toEqual({
      simulation_output_id: input.simulation_output_id,
      status: 'COMPLETED',
      transcript: 'persona: Can I renew online?\nagent: Yes.',
      next_transcript_offset: null,
    });
    for (const index of [0, 1, 2, 3]) {
      const { headers } = requestAt(index);
      expect(headers.get('x-coval-workspace-id')).toBe(input.workspace_id);
      expect(headers.get('x-api-key')).toBe('review-test-key');
    }
  });

  it('keeps uploaded dialogue in the project and does not fall back after permission denial', async () => {
    upstream
      .mockResolvedValueOnce(json({ review_project: project }))
      .mockResolvedValueOnce(json({ error: { code: 'NOT_FOUND' } }, 404))
      .mockResolvedValueOnce(json({
        uploaded_conversation: {
          conversation_id: input.simulation_output_id,
          transcript: [{ role: 'user', content: null, message: 'Uploaded dialogue.' }],
        },
      }))
      .mockResolvedValueOnce(json({ review_project: project }))
      .mockResolvedValueOnce(json({ error: { code: 'PERMISSION_DENIED' } }, 403))
      .mockResolvedValueOnce(json({ review_project: project }));
    expect(resultPayload(await call('get_review_conversation', input)).transcript).toBe('user: Uploaded dialogue.');
    expect(requestAt(2).url.pathname).toBe('/v1/conversations/uploaded/conversation_1');
    const denied = await call('get_review_conversation', input);
    expect(denied.isError).toBe(true);
    expect(resultPayload(denied).error).toBe('PERMISSION_DENIED');
    const unlinked = await call('get_review_conversation', { ...input, simulation_output_id: 'unlinked' });
    expect(unlinked.isError).toBe(true);
    expect(upstream).toHaveBeenCalledTimes(6);
  });

  it('writes as the authenticated reviewer and distinguishes an answer from completed submission', async () => {
    upstream
      .mockResolvedValueOnce(json(receipt, 201))
      .mockResolvedValueOnce(json(receipt))
      .mockResolvedValueOnce(json({
        success: false,
        is_complete: false,
        completed_conversation_count: 0,
        blockers: [{ code: 'MISSING_DISAGREEMENT_NOTE', metric_id: 'metric_1', message: 'provide notes' }],
      }))
      .mockResolvedValueOnce(json({ success: true, is_complete: true, completed_conversation_count: 1, blockers: [] }));
    const recorded = await call('create_review_annotation', {
      ...input, metric_id: 'metric_1', ground_truth_float_value: 0, ground_truth_json: '{"complete":false}',
    });
    expect(recorded.isError).not.toBe(true);
    expect(requestAt(0).method).toBe('POST');
    expect(requestAt(0).body).toEqual({
      simulation_output_id: input.simulation_output_id,
      metric_id: 'metric_1',
      ground_truth_float_value: 0,
      ground_truth_json: { complete: false },
    });
    expect(requestAt(0).url.pathname).toBe('/v1/review-annotations');
    expect(requestAt(0).url.searchParams.get('project_id')).toBe(input.project_id);
    expect(JSON.stringify(recorded)).not.toContain('private-reviewer');

    const changed = await call('update_review_annotation', {
      project_id: input.project_id, annotation_id: 'annotation_1',
      workspace_id: input.workspace_id, ground_truth_json: null, reviewer_notes: 'Checked the answer.',
    });
    expect(changed.isError).not.toBe(true);
    expect(requestAt(1).body).toEqual({ ground_truth_json: null, reviewer_notes: 'Checked the answer.' });
    expect(requestAt(1).method).toBe('PATCH');
    expect(requestAt(1).url.pathname).toBe('/v1/review-annotations/annotation_1');
    const blocked = await call('complete_review_conversation', input);
    expect(resultPayload(blocked)).toEqual({
      success: false, is_complete: false, completed_conversation_count: 0,
      blockers: [{ code: 'MISSING_DISAGREEMENT_NOTE', metric_id: 'metric_1' }],
    });
    expect(requestAt(2).body).toEqual({ simulation_output_id: input.simulation_output_id });
    expect(requestAt(2).url.pathname).toBe('/v1/review-projects/project_1/complete-conversation');
    expect(resultPayload(await call('complete_review_conversation', input)).is_complete).toBe(true);
  });

  it('rejects identity overrides, invalid answers, and missing project scope before writing', async () => {
    const base = { ...input, metric_id: 'metric_1' };
    for (const args of [
      { ...base, ground_truth_float_value: 1, assignee: 'other@example.invalid' },
      { ...base, ground_truth_json: '{"invalid":1e400}' },
      { ...base, ground_truth_subvalues_by_timestamp: '[0]' },
      base,
      { ...base, project_id: undefined, ground_truth_float_value: 1 },
    ]) {
      expect((await call('create_review_annotation', args)).isError).toBe(true);
    }
    expect((await call('complete_review_conversation', { ...input, assignee_user_id: 'other' })).isError).toBe(true);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('returns a safe API authorization error and makes one write request', async () => {
    upstream.mockResolvedValueOnce(json({ error: {
      code: 'PERMISSION_DENIED', message: 'private upstream diagnostic',
    } }, 403));
    const result = await call('create_review_annotation', { ...input, metric_id: 'metric_1', ground_truth_float_value: 1 });
    expect(result.isError).toBe(true);
    expect(resultPayload(result).error).toBe('PERMISSION_DENIED');
    expect(JSON.stringify(result)).not.toContain('private upstream diagnostic');
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});
