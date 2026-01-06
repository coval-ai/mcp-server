#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CovalApiClient } from './client.js';
import { registerAllTools } from './tools/index.js';

function createMcpServer(getApiKey?: () => string) {
  const mcpServer = new McpServer({
    name: 'Coval MCP',
    version: '0.1.0',
  });

  const apiKey = getApiKey?.() || process.env.COVAL_API_KEY;

  if (apiKey) {
    const client = new CovalApiClient(apiKey);
    registerAllTools(mcpServer, client);
  } else {
    mcpServer.tool(
      'ping',
      'Test tool to verify MCP server is working.',
      {},
      async () => ({
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              status: 'ok',
              message: 'pong',
              version: '0.1.0',
              note: 'Set COVAL_API_KEY to enable all tools',
            }),
          },
        ],
      })
    );
  }

  return mcpServer;
}

async function main() {
  try {
    console.error('Starting Coval MCP server...');
    const mcpServer = createMcpServer();
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    console.error('Coval MCP server connected');
    setupShutdownHandler(mcpServer);
  } catch (err) {
    console.error('Failed to start MCP server:', err);
    process.exit(1);
  }
}

function setupShutdownHandler(mcpServer: McpServer) {
  const shutdown = async () => {
    console.error('Shutting down...');
    try {
      await mcpServer.close();
      process.exit(0);
    } catch (err) {
      console.error('Shutdown error:', err);
      process.exit(1);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});

export { createMcpServer };
