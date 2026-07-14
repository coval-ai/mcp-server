import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from './client.js';
import { registerAllTools } from './tools/index.js';

export const COVAL_MCP_SERVER_VERSION = '0.2.0';

const COVAL_OVERVIEW = `Coval evaluates AI agents (voice, SMS, chat) by running simulated conversations.

Entities:
- Agent: The AI being evaluated
- Persona: Simulated user behavior
- Test Set: Collection of test cases
- Test Case: Single scenario
- Run: Agent + persona + test set evaluation
- Metrics: Organization-specific evaluation criteria`;

export interface CovalMcpServerOptions {
  apiKey?: string;
  includeCovi?: boolean;
}

function overviewFor(options: CovalMcpServerOptions): string {
  if (!options.apiKey) {
    return `${COVAL_OVERVIEW}\n\nAuthenticate to access Coval organization tools.`;
  }
  if (options.includeCovi === false) {
    return `${COVAL_OVERVIEW}\n\nUse direct tools for deterministic Coval operations.`;
  }
  return `${COVAL_OVERVIEW}\n\nUse direct tools for deterministic operations. Use consult_covi when the task benefits from\nCoval product knowledge, voice-agent evaluation expertise, or synthesis across resources.`;
}

export function createMcpServer(options: CovalMcpServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'Coval MCP', version: COVAL_MCP_SERVER_VERSION });

  server.resource('overview', 'coval://overview', async () => ({
    contents: [{ uri: 'coval://overview', mimeType: 'text/plain', text: overviewFor(options) }],
  }));

  if (options.apiKey) {
    registerAllTools(server, new CovalApiClient(options.apiKey), {
      includeCovi: options.includeCovi,
    });
  } else {
    server.tool('ping', 'Test whether the Coval MCP server is available.', {}, async () => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ status: 'ok', version: COVAL_MCP_SERVER_VERSION }),
        },
      ],
    }));
  }

  return server;
}
