import { z } from 'zod';
import { PaginationInputSchema } from './common.js';

export const ListRunsInputSchema = PaginationInputSchema.extend({}).describe(
  'Input for listing evaluation runs'
);

export const GetRunInputSchema = z.object({
  run_id: z
    .string()
    .min(1)
    .describe('The unique ID of the run to retrieve. Get this from list_runs.'),
});

export const CreateRunInputSchema = z.object({
  agent_id: z
    .string()
    .min(1)
    .describe('The unique ID of the agent to evaluate. Get this from list_agents.'),
  persona_id: z
    .string()
    .min(1)
    .describe('The unique ID of the persona to use. Get this from list_personas.'),
  test_set_id: z
    .string()
    .min(1)
    .describe('The unique ID of the test set to run against. Get this from list_test_sets.'),
  metric_ids: z
    .array(z.string())
    .optional()
    .describe('Optional list of metric IDs to evaluate. Uses agent defaults if omitted.'),
  options: z
    .object({
      iteration_count: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe('Number of iterations per test case (1-10, default 1)'),
      concurrency: z
        .number()
        .int()
        .min(1)
        .max(5)
        .optional()
        .describe('Number of parallel simulations (1-5, default 1)'),
    })
    .optional()
    .describe('Run configuration options'),
  metadata: z
    .record(z.unknown())
    .optional()
    .describe('Custom metadata for tracking purposes'),
});

export const DeleteRunInputSchema = z.object({
  run_id: z
    .string()
    .min(1)
    .describe('The unique ID of the run to cancel or delete.'),
});

export type ListRunsInput = z.infer<typeof ListRunsInputSchema>;
export type GetRunInput = z.infer<typeof GetRunInputSchema>;
export type CreateRunInput = z.infer<typeof CreateRunInputSchema>;
export type DeleteRunInput = z.infer<typeof DeleteRunInputSchema>;
