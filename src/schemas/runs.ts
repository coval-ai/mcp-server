import { z } from 'zod';
import {
  PaginationInputSchema,
  ResourceIdSchema,
  StrictPaginationInputSchema,
} from './common.js';

export const ListRunsInputSchema = StrictPaginationInputSchema.extend({}).describe(
  'Input for listing evaluation runs'
);

export const LegacyListRunsInputSchema =
  PaginationInputSchema.extend({}).describe(
    'Input for listing evaluation runs',
  );

export const GetRunInputSchema = z.object({
  run_id: ResourceIdSchema.describe('The unique ID of the run to retrieve.'),
}).strict();

export const CreateRunInputSchema = z.object({
  agent_id: ResourceIdSchema.describe('The unique ID of the agent to evaluate.'),
  persona_id: ResourceIdSchema.describe('The unique ID of the persona to use.'),
  test_set_id: ResourceIdSchema.describe(
    'The unique ID of the test set to run against.',
  ),
  metric_ids: z
    .array(ResourceIdSchema)
    .max(50)
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
    .strict()
    .optional()
    .describe('Run configuration options'),
  tags: z
    .array(z.string().trim().min(1).max(200))
    .max(20)
    .optional()
    .describe('Tags for categorizing and filtering the run (max 20 tags, 200 chars each).'),
}).strict();

export const LegacyCreateRunInputSchema = z.object({
  agent_id: z
    .string()
    .min(1)
    .describe('The unique ID of the agent to evaluate.'),
  persona_id: z
    .string()
    .min(1)
    .describe('The unique ID of the persona to use.'),
  test_set_id: z
    .string()
    .min(1)
    .describe('The unique ID of the test set to run against.'),
  metric_ids: z
    .array(z.string())
    .optional()
    .describe('Optional list of metric IDs to evaluate. Uses agent defaults if omitted.'),
  options: z
    .object({
      iteration_count: z.number().int().min(1).max(10).optional(),
      concurrency: z.number().int().min(1).max(5).optional(),
    })
    .optional()
    .describe('Run configuration options'),
  tags: z
    .array(z.string().max(200))
    .max(20)
    .optional()
    .describe('Tags for categorizing and filtering the run (max 20 tags, 200 chars each).'),
  metadata: z
    .record(z.unknown())
    .optional()
    .describe('Custom metadata for tracking purposes'),
});

export type ListRunsInput = z.infer<typeof ListRunsInputSchema>;
export type LegacyListRunsInput = z.infer<typeof LegacyListRunsInputSchema>;
export type GetRunInput = z.infer<typeof GetRunInputSchema>;
export type CreateRunInput = z.infer<typeof CreateRunInputSchema>;
export type LegacyCreateRunInput = z.infer<typeof LegacyCreateRunInputSchema>;
