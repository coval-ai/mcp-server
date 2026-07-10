#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpServer } from './server.js';

async function main() {
  try {
    console.error('Starting Coval MCP server...');
    const mcpServer = createMcpServer({ apiKey: process.env.COVAL_API_KEY });
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

export { createMcpServer } from './server.js';
