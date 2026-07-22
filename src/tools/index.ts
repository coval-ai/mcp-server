import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../client.js';
import { registerRunTools } from './runs.js';
import { registerAgentTools } from './agents.js';
import { registerTestSetTools } from './test-sets.js';
import { registerTestCaseTools } from './test-cases.js';
import { registerMetricTools } from './metrics.js';
import { registerPersonaTools } from './personas.js';
import { registerSofiaTools } from './sofia.js';

export function registerAllTools(
  server: McpServer,
  client: CovalApiClient,
  options: { includeSofia?: boolean } = {},
) {
  registerRunTools(server, client);
  registerAgentTools(server, client);
  registerTestSetTools(server, client);
  registerTestCaseTools(server, client);
  registerMetricTools(server, client);
  registerPersonaTools(server, client);
  if (options.includeSofia ?? true) {
    registerSofiaTools(server, client);
  }
}
