#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

function createMcpServer(_getApiKey?: () => string) {
  const mcpServer = new McpServer({
    name: 'Coval MCP',
    version: '0.1.0',
  });

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
            timestamp: new Date().toISOString(),
          }),
        },
      ],
    })
  );

  mcpServer.tool(
    'list_available_tools',
    'Lists all tools available in the Coval MCP server.',
    {},
    async () => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            status: 'coming_soon',
            planned_tools: {
              runs: ['list_runs', 'get_run', 'create_run', 'delete_run'],
              agents: ['list_agents', 'get_agent', 'create_agent', 'update_agent'],
              test_sets: ['list_test_sets', 'get_test_set', 'create_test_set'],
              metrics: ['list_metrics', 'get_metric'],
              personas: ['list_personas', 'get_persona'],
            },
          }),
        },
      ],
    })
  );

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
