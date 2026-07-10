import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from './client.js';
import { registerAllTools } from './tools/index.js';

const COVAL_OVERVIEW = `Coval evaluates AI agents (voice, SMS, chat) by running simulated conversations.

Entities:
- Agent: The AI being evaluated
- Persona: Simulated user behavior
- Test Set: Collection of test cases
- Test Case: Single scenario
- Run: Agent + persona + test set evaluation
- Metrics: Organization-specific evaluation criteria

Use direct tools for deterministic operations. Use consult_covi when the task benefits from
Coval product knowledge, voice-agent evaluation expertise, or synthesis across resources.`;

export interface CovalMcpServerOptions {
  apiKey?: string;
  includeCovi?: boolean;
}

export function createMcpServer(options: CovalMcpServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'Coval MCP', version: '0.2.0' });

  server.resource('overview', 'coval://overview', async () => ({
    contents: [{ uri: 'coval://overview', mimeType: 'text/plain', text: COVAL_OVERVIEW }],
  }));

  if (options.apiKey) {
    registerAllTools(server, new CovalApiClient(options.apiKey), {
      includeCovi: options.includeCovi,
    });
  } else {
    server.tool('ping', 'Test whether the Coval MCP server is available.', {}, async () => ({
      content: [{ type: 'text' as const, text: JSON.stringify({ status: 'ok', version: '0.2.0' }) }],
    }));
  }

  return server;
}
