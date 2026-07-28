import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../client.js';
import { registerRunTools } from './runs.js';
import { registerAgentTools } from './agents.js';
import { registerTestSetTools } from './test-sets.js';
import { registerTestCaseTools } from './test-cases.js';
import { registerMetricTools } from './metrics.js';
import { registerPersonaTools } from './personas.js';
import { registerSofiaTools } from './sofia.js';
import type {
  ToolAnnotationProfile,
  ToolInputProfile,
} from './annotations.js';

export function registerAllTools(
  server: McpServer,
  client: CovalApiClient,
  options: {
    annotationProfile?: ToolAnnotationProfile;
    inputProfile?: ToolInputProfile;
    includeSofia?: boolean;
  } = {},
) {
  const createToolOptions = {
    annotationProfile: options.annotationProfile,
    inputProfile: options.inputProfile,
  };
  registerRunTools(server, client, createToolOptions);
  registerAgentTools(server, client, createToolOptions);
  registerTestSetTools(server, client, createToolOptions);
  registerTestCaseTools(server, client, createToolOptions);
  registerMetricTools(server, client, {
    inputProfile: options.inputProfile,
  });
  registerPersonaTools(server, client, {
    inputProfile: options.inputProfile,
  });
  if (options.includeSofia ?? true) {
    registerSofiaTools(server, client, {
      inputProfile: options.inputProfile,
    });
  }
}
