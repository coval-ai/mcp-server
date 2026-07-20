import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../client.js';
import { ListMetricsInputSchema, GetMetricInputSchema } from '../schemas/index.js';
import { createSuccessResponse } from '../utils/response.js';
import { handleApiError } from '../utils/errors.js';
import { readOnlyTool } from './annotations.js';

export function registerMetricTools(server: McpServer, client: CovalApiClient) {
  server.registerTool(
    'list_metrics',
    {
      title: 'List metrics',
      description:
        'List available evaluation metrics. Metrics define how agent performance is measured. Set include_builtin=true to see built-in metrics.',
      inputSchema: ListMetricsInputSchema.shape,
      annotations: readOnlyTool(),
    },
    async (params) => {
      try {
        const result = await client.listMetrics(params);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );

  server.registerTool(
    'get_metric',
    {
      title: 'Get metric',
      description:
        'Get detailed information about a specific metric. Shows metric type, description, and configuration.',
      inputSchema: GetMetricInputSchema.shape,
      annotations: readOnlyTool(),
    },
    async (params) => {
      try {
        const result = await client.getMetric(params.metric_id);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );
}
