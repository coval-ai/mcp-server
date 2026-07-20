import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../client.js';
import { ListMetricsInputSchema, GetMetricInputSchema } from '../schemas/index.js';
import { createSuccessResponse } from '../utils/response.js';
import { handleApiError } from '../utils/errors.js';
import { readOnlyTool } from './annotations.js';

export function registerMetricTools(server: McpServer, client: CovalApiClient) {
  server.tool(
    'list_metrics',
    'List available evaluation metrics. Metrics define how agent performance is measured. Set include_builtin=true to see built-in metrics.',
    ListMetricsInputSchema.shape,
    readOnlyTool('List metrics'),
    async (params) => {
      try {
        const result = await client.listMetrics(params);
        return createSuccessResponse(result);
      } catch (err) {
        return handleApiError(err);
      }
    }
  );

  server.tool(
    'get_metric',
    'Get detailed information about a specific metric. Shows metric type, description, and configuration.',
    GetMetricInputSchema.shape,
    readOnlyTool('Get metric'),
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
