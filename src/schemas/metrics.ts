import { z } from 'zod';
import {
  PaginationInputSchema,
  ResourceIdSchema,
  StrictPaginationInputSchema,
} from './common.js';

export const ListMetricsInputSchema = StrictPaginationInputSchema.extend({
  include_builtin: z
    .boolean()
    .optional()
    .describe('Include built-in metrics in results (default false)'),
}).describe('Input for listing available metrics');

export const LegacyListMetricsInputSchema = PaginationInputSchema.extend({
  include_builtin: z
    .boolean()
    .optional()
    .describe('Include built-in metrics in results (default false)'),
}).describe('Input for listing available metrics');

export const GetMetricInputSchema = z.object({
  metric_id: ResourceIdSchema.describe('The unique ID of the metric to retrieve.'),
}).strict();

export type ListMetricsInput = z.infer<typeof ListMetricsInputSchema>;
export type LegacyListMetricsInput = z.infer<typeof LegacyListMetricsInputSchema>;
export type GetMetricInput = z.infer<typeof GetMetricInputSchema>;
