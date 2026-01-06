import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../client.js';
import { registerRunTools } from './runs.js';
import { registerAgentTools } from './agents.js';
import { registerTestSetTools } from './test-sets.js';
import { registerMetricTools } from './metrics.js';
import { registerPersonaTools } from './personas.js';

export function registerAllTools(server: McpServer, client: CovalApiClient) {
  registerRunTools(server, client);
  registerAgentTools(server, client);
  registerTestSetTools(server, client);
  registerMetricTools(server, client);
  registerPersonaTools(server, client);
}
