import type {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { CovalApiClient } from './client.js';
import { registerAllTools } from './tools/index.js';

const COVAL_OVERVIEW = `Coval evaluates AI agents (voice, SMS, chat) by running simulated conversations.

Entities:
- Agent: The AI being evaluated (model_type: VOICE, OUTBOUND_VOICE, SMS, WEBSOCKET, CHAT)
- Persona: Simulated user that calls/texts the agent (voice, language, background_sound, behavior prompt)
- Test Set: Collection of test cases (scenarios)
- Test Case: Single scenario with input_str (opening message or JSON message array)
- Run: One evaluation = agent + persona + test_set → produces metrics
- Metrics: Custom per organization (e.g., latency, accuracy, task completion)

Workflow: list_agents → list_personas → list_test_sets → create_run → get_run (poll until COMPLETED)`;

function createMcpServer(apiKey?: string): McpServer {
  const mcpServer = new McpServer({
    name: 'Coval MCP',
    version: '0.1.0',
  });

  // Register system overview resource
  mcpServer.resource('overview', 'coval://overview', async () => ({
    contents: [{ uri: 'coval://overview', mimeType: 'text/plain', text: COVAL_OVERVIEW }],
  }));

  if (apiKey) {
    const client = new CovalApiClient(apiKey);
    registerAllTools(mcpServer, client);
  } else {
    mcpServer.tool('ping', 'Test tool to verify MCP server is working.', {}, async () => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            status: 'ok',
            message: 'pong',
            version: '0.1.0',
            note: 'Provide X-API-Key header to enable all tools',
          }),
        },
      ],
    }));
  }

  return mcpServer;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export async function handler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  const method = event.requestContext.http.method;
  const path = event.rawPath;

  // Health check
  if (path === '/health') {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'healthy',
        service: 'coval-mcp-server',
        version: '0.1.0',
      }),
    };
  }

  if (path !== '/mcp') {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Not found' }),
    };
  }

  if (method !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'application/json', Allow: 'POST' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  // Check Accept header
  const accept = event.headers['accept'] || '';
  if (!accept.includes('application/json') && !accept.includes('*/*') && accept !== '') {
    return {
      statusCode: 406,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Not Acceptable: Client must accept application/json' },
        id: null,
      }),
    };
  }

  const apiKey =
    event.headers['x-api-key'] ||
    event.headers['X-API-Key'] ||
    event.headers['X-Api-Key'];

  try {
    const bodyStr = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf-8')
      : event.body || '';

    const request: JsonRpcRequest = JSON.parse(bodyStr);

    // Create server and connect via in-memory transport
    const mcpServer = createMcpServer(apiKey);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    const client = new Client({ name: 'lambda-client', version: '1.0.0' }, {});

    await Promise.all([
      mcpServer.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    let response: JsonRpcResponse;

    switch (request.method) {
      case 'initialize': {
        await client.getServerVersion(); // Ensure connection is established
        response = {
          jsonrpc: '2.0',
          id: request.id ?? null,
          result: {
            protocolVersion: request.params?.protocolVersion || '2024-11-05',
            capabilities: { tools: { listChanged: true }, resources: { listChanged: true } },
            serverInfo: { name: 'Coval MCP', version: '0.1.0' },
            instructions: "Use Coval tools for testing and evaluating AI agents (voice, SMS, chat). Create evaluation runs, manage test sets/cases, configure simulated personas, and retrieve quality metrics"
          },
        };
        break;
      }

      case 'notifications/initialized':
      case 'notifications/cancelled': {
        // Notifications don't need responses
        return {
          statusCode: 202,
          headers: { 'Content-Type': 'application/json' },
          body: '',
        };
      }

      case 'tools/list': {
        const tools = await client.listTools();
        response = {
          jsonrpc: '2.0',
          id: request.id ?? null,
          result: { tools: tools.tools },
        };
        break;
      }

      case 'tools/call': {
        const params = request.params as { name: string; arguments?: Record<string, unknown> };
        const result = await client.callTool({ name: params.name, arguments: params.arguments || {} });
        response = {
          jsonrpc: '2.0',
          id: request.id ?? null,
          result,
        };
        break;
      }

      case 'resources/list': {
        const resources = await client.listResources();
        response = {
          jsonrpc: '2.0',
          id: request.id ?? null,
          result: { resources: resources.resources },
        };
        break;
      }

      case 'resources/read': {
        const params = request.params as { uri: string };
        const result = await client.readResource({ uri: params.uri });
        response = {
          jsonrpc: '2.0',
          id: request.id ?? null,
          result,
        };
        break;
      }

      default: {
        response = {
          jsonrpc: '2.0',
          id: request.id ?? null,
          error: { code: -32601, message: `Method not found: ${request.method}` },
        };
      }
    }

    // Cleanup
    await client.close();
    await mcpServer.close();

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('MCP handler error:', error);
    return {
      statusCode: 200, // JSON-RPC errors still return 200
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'Internal error',
        },
        id: null,
      }),
    };
  }
}
