import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { jest } from '@jest/globals';
import { CovalApiClient } from '../../src/client.js';
import { IssueActionInputSchema, ClearancePolicySchema } from '../../src/schemas/issues.js';
import { registerIssueTools } from '../../src/tools/issues.js';

type ToolHandler = (params: Record<string, unknown>) => Promise<CallToolResult>;

function responsePayload(result: CallToolResult): Record<string, unknown> {
  const content = result.content[0];
  if (content?.type !== 'text') throw new Error('Expected a text tool response');
  return JSON.parse(content.text) as Record<string, unknown>;
}

function collectHandlers(client: CovalApiClient) {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: ToolHandler) => handlers.set(name, handler),
  } as unknown as McpServer;
  registerIssueTools(server, client);
  return handlers;
}

describe('issue tools', () => {
  it('registers the full lifecycle surface', () => {
    const handlers = collectHandlers({} as CovalApiClient);
    expect([...handlers.keys()].sort()).toEqual([
      'create_issue',
      'get_issue',
      'get_issues_summary',
      'issue_action',
      'list_issues',
      'list_regression_suite',
    ]);
  });

  it('forwards the board filters to the API', async () => {
    const client = {
      listIssues: jest.fn(async () => ({ issues: [{ id: 'issue_1' }], next_page_token: null })),
    } as unknown as CovalApiClient;
    const handlers = collectHandlers(client);
    const result = await handlers.get('list_issues')!({ status: ['confirmed', 'clearing'], owner: 'me' });
    expect(client.listIssues).toHaveBeenCalledWith({ status: ['confirmed', 'clearing'], owner: 'me' });
    expect(responsePayload(result)).toEqual({ issues: [{ id: 'issue_1' }], next_page_token: null });
  });

  it('splits issue_id from the action body', async () => {
    const client = {
      applyIssueAction: jest.fn(async () => ({ issue: { id: 'issue_1', version: 3 }, event: { event_type: 'confirmed' } })),
    } as unknown as CovalApiClient;
    const handlers = collectHandlers(client);
    await handlers.get('issue_action')!({ issue_id: 'issue_1', action: 'confirm', expected_version: 2, severity: 'high' });
    expect(client.applyIssueAction).toHaveBeenCalledWith('issue_1', {
      action: 'confirm',
      expected_version: 2,
      severity: 'high',
    });
  });

  it('rejects an action without the version guard and a policy without metrics', () => {
    expect(IssueActionInputSchema.safeParse({ issue_id: 'issue_1', action: 'confirm' }).success).toBe(false);
    expect(
      ClearancePolicySchema.safeParse({ success_rate_min: 0.98, min_valid_simulations: 1000, required_metric_ids: [] }).success,
    ).toBe(false);
    expect(
      ClearancePolicySchema.safeParse({ success_rate_min: 0.98, min_valid_simulations: 1000, required_metric_ids: ['m_1'] }).success,
    ).toBe(true);
  });
});
