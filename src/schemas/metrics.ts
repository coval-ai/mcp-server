import { z } from 'zod';
import { PaginationInputSchema } from './common.js';

export const ListMetricsInputSchema = PaginationInputSchema.extend({
  include_builtin: z
    .boolean()
    .optional()
    .describe('Include built-in metrics in results (default false)'),
}).describe('Input for listing available metrics');

export const GetMetricInputSchema = z.object({
  metric_id: z
    .string()
    .min(1)
    .describe('The unique ID of the metric to retrieve. Get this from list_metrics.'),
});

export type ListMetricsInput = z.infer<typeof ListMetricsInputSchema>;
export type GetMetricInput = z.infer<typeof GetMetricInputSchema>;
