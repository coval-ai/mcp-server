import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { jest } from '@jest/globals';
import { CovalApiClient } from '../../src/client.js';
import { registerSofiaTools } from '../../src/tools/sofia.js';

type SofiaToolHandler = (params: { prompt: string }) => Promise<CallToolResult>;

describe('consult_sofia tool output', () => {
  it('keeps the request ID inside the client boundary and omits it from model-visible output', async () => {
    let handler: SofiaToolHandler | undefined;
    const server = {
      registerTool: (
        name: string,
        _config: unknown,
        registeredHandler: SofiaToolHandler,
      ) => {
        expect(name).toBe('consult_sofia');
        handler = registeredHandler;
      },
    } as unknown as McpServer;
    const consultSofia = jest.fn(async () => ({
      contractVersion: '1',
      requestId: 'internal-request-123',
      mode: 'read_only' as const,
      summary: 'Inspect the latest failed run.',
      evidence: [{ name: 'list_recent_runs', status: 'succeeded' }],
      proposedActions: [] as never[],
    }));
    const client = { consultSofia } as unknown as CovalApiClient;

    registerSofiaTools(server, client, { inputProfile: 'openai' });

    expect(handler).toBeDefined();
    const response = await handler!({
      prompt: 'What should I inspect?',
    });
    const content = response.content[0];
    expect(content.type).toBe('text');
    if (content.type !== 'text') {
      throw new Error('Expected a text tool response');
    }
    const visibleOutput = JSON.parse(content.text) as Record<string, unknown>;

    expect(consultSofia).toHaveBeenCalledWith({
      prompt: 'What should I inspect?',
    });
    expect(visibleOutput).toEqual({
      contract_version: '1',
      mode: 'read_only',
      summary: 'Inspect the latest failed run.',
      evidence: [{ name: 'list_recent_runs', status: 'succeeded' }],
      proposed_actions: [],
    });
    expect(visibleOutput).not.toHaveProperty('request_id');
    expect(content.text).not.toContain('internal-request-123');
  });
});
