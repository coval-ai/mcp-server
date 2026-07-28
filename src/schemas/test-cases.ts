import { z } from 'zod';
import {
  OpenAiTestSetIdSchema,
  PaginationInputSchema,
  ResourceIdSchema,
  StrictPaginationInputSchema,
} from './common.js';

export const ListTestCasesInputSchema = StrictPaginationInputSchema.omit({
  filter: true,
}).extend({
  test_set_id: OpenAiTestSetIdSchema
    .optional()
    .describe('Return only test cases in this test set.'),
}).strict().describe('Input for listing test cases');

export const GetTestCaseInputSchema = z.object({
  test_case_id: ResourceIdSchema.describe('The unique ID of the test case to retrieve.'),
}).strict();

export const CreateTestCaseInputSchema = z.object({
  test_set_id: OpenAiTestSetIdSchema.describe(
    'The eight-character ID of the test set to add this test case to.',
  ),
  input_str: z
    .string()
    .trim()
    .min(1)
    .max(50000)
    .describe(
      'Synthetic evaluation scenario or scripted message sequence presented to the agent. Never include the current ChatGPT conversation.',
    ),
  expected_behaviors: z
    .array(z.string().trim().min(1).max(2000))
    .max(50)
    .optional()
    .describe('List of expected agent behaviors or responses for evaluation.'),
  description: z
    .string()
    .trim()
    .min(1)
    .max(4000)
    .optional()
    .describe('Human-readable description of what this test case validates.'),
}).strict();

export const UpdateTestCaseInputSchema = z.object({
  test_case_id: ResourceIdSchema.describe('The unique ID of the test case to update.'),
  input_str: z
    .string()
    .trim()
    .min(1)
    .max(50000)
    .optional()
    .describe(
      'Updated synthetic evaluation scenario or scripted message sequence. Never include the current ChatGPT conversation.',
    ),
  expected_behaviors: z
    .array(z.string().trim().min(1).max(2000))
    .max(50)
    .optional()
    .describe('Updated list of expected agent behaviors.'),
  description: z
    .string()
    .trim()
    .min(1)
    .max(4000)
    .optional()
    .describe('Updated description.'),
}).strict();

export const LegacyListTestCasesInputSchema = PaginationInputSchema.extend({}).describe(
  'Input for listing test cases. Use filter="test_set_id=\\"abc12345\\"" to filter by test set.',
);

export const LegacyCreateTestCaseInputSchema = z.object({
  test_set_id: z
    .string()
    .length(8)
    .describe('The 8-character ID of the test set to add this test case to.'),
  input_str: z
    .string()
    .min(1)
    .describe('The test input or scenario that will be presented to the agent.'),
  expected_behaviors: z
    .array(z.string())
    .optional()
    .describe('List of expected agent behaviors or responses for evaluation.'),
  description: z.string().optional().describe(
    'Human-readable description of what this test case validates.',
  ),
  simulation_metadata_input: z
    .record(z.unknown())
    .optional()
    .describe('Additional context passed to the simulation environment.'),
  metric_input: z
    .record(z.unknown())
    .optional()
    .describe('Custom inputs for metric evaluation.'),
  user_notes: z.string().optional().describe('Internal notes about this test case.'),
});

export const LegacyUpdateTestCaseInputSchema = z.object({
  test_case_id: ResourceIdSchema.describe('The unique ID of the test case to update.'),
  input_str: z.string().min(1).optional().describe('Updated test input or scenario.'),
  expected_behaviors: z
    .array(z.string())
    .optional()
    .describe('Updated list of expected agent behaviors.'),
  description: z.string().optional().describe('Updated description.'),
  simulation_metadata_input: z
    .record(z.unknown())
    .optional()
    .describe('Updated simulation context.'),
  metric_input: z.record(z.unknown()).optional().describe('Updated metric inputs.'),
  user_notes: z.string().optional().describe('Updated internal notes.'),
});

export type ListTestCasesInput = z.infer<typeof ListTestCasesInputSchema>;
export type GetTestCaseInput = z.infer<typeof GetTestCaseInputSchema>;
export type CreateTestCaseInput = z.infer<typeof CreateTestCaseInputSchema>;
export type UpdateTestCaseInput = z.infer<typeof UpdateTestCaseInputSchema>;
export type LegacyListTestCasesInput = z.infer<typeof LegacyListTestCasesInputSchema>;
export type LegacyCreateTestCaseInput = z.infer<typeof LegacyCreateTestCaseInputSchema>;
export type LegacyUpdateTestCaseInput = z.infer<typeof LegacyUpdateTestCaseInputSchema>;
