import { z } from 'zod';
import {
  OpenAiTestSetIdSchema,
  PaginationInputSchema,
  ResourceIdSchema,
  StrictPaginationInputSchema,
} from './common.js';

export const ListTestSetsInputSchema = StrictPaginationInputSchema.extend({}).describe(
  'Input for listing test sets'
);

export const LegacyListTestSetsInputSchema = PaginationInputSchema.extend({}).describe(
  'Input for listing test sets',
);

export const GetTestSetInputSchema = z.object({
  test_set_id: OpenAiTestSetIdSchema.describe(
    'The eight-character ID of the test set to retrieve.',
  ),
}).strict();

export const LegacyGetTestSetInputSchema = z.object({
  test_set_id: ResourceIdSchema.describe('The unique ID of the test set to retrieve.'),
});

export const CreateTestSetInputSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .describe('Human-readable name for the test set'),
  description: z
    .string()
    .trim()
    .min(1)
    .max(4000)
    .optional()
    .describe('Description of the test set'),
  test_set_type: z
    .enum(['DEFAULT', 'SCENARIO', 'TRANSCRIPT', 'WORKFLOW'])
    .optional()
    .describe('Type of test set: DEFAULT, SCENARIO, TRANSCRIPT, WORKFLOW'),
}).strict();

export const LegacyCreateTestSetInputSchema = z.object({
  display_name: z
    .string()
    .min(1)
    .max(100)
    .describe('Human-readable name for the test set'),
  slug: z
    .string()
    .max(100)
    .optional()
    .describe('URL-friendly identifier (auto-generated if not provided)'),
  description: z.string().optional().describe('Description of the test set'),
  test_set_type: z
    .string()
    .optional()
    .describe('Type of test set: DEFAULT, SCENARIO, TRANSCRIPT, WORKFLOW'),
  test_set_metadata: z
    .record(z.unknown())
    .optional()
    .describe('Additional configuration metadata'),
  parameters: z
    .record(z.unknown())
    .optional()
    .describe('Test case parameterization (e.g., {"name": ["Alice", "Bob"]})'),
});

export type ListTestSetsInput = z.infer<typeof ListTestSetsInputSchema>;
export type LegacyListTestSetsInput = z.infer<typeof LegacyListTestSetsInputSchema>;
export type GetTestSetInput = z.infer<typeof GetTestSetInputSchema>;
export type LegacyGetTestSetInput = z.infer<typeof LegacyGetTestSetInputSchema>;
export type CreateTestSetInput = z.infer<typeof CreateTestSetInputSchema>;
export type LegacyCreateTestSetInput = z.infer<typeof LegacyCreateTestSetInputSchema>;
