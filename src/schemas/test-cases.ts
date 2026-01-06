import { z } from 'zod';
import { PaginationInputSchema } from './common.js';

export const ListTestCasesInputSchema = PaginationInputSchema.extend({}).describe(
  'Input for listing test cases. Use filter="test_set_id=\\"abc12345\\"" to filter by test set.'
);

export const GetTestCaseInputSchema = z.object({
  test_case_id: z
    .string()
    .min(1)
    .describe('The unique ID of the test case to retrieve.'),
});

export const CreateTestCaseInputSchema = z.object({
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
  description: z
    .string()
    .optional()
    .describe('Human-readable description of what this test case validates.'),
  simulation_metadata_input: z
    .record(z.unknown())
    .optional()
    .describe('Additional context passed to the simulation environment.'),
  metric_input: z
    .record(z.unknown())
    .optional()
    .describe('Custom inputs for metric evaluation.'),
  user_notes: z
    .string()
    .optional()
    .describe('Internal notes about this test case.'),
});

export const UpdateTestCaseInputSchema = z.object({
  test_case_id: z
    .string()
    .min(1)
    .describe('The unique ID of the test case to update.'),
  input_str: z
    .string()
    .min(1)
    .optional()
    .describe('Updated test input or scenario.'),
  expected_behaviors: z
    .array(z.string())
    .optional()
    .describe('Updated list of expected agent behaviors.'),
  description: z
    .string()
    .optional()
    .describe('Updated description.'),
  simulation_metadata_input: z
    .record(z.unknown())
    .optional()
    .describe('Updated simulation context.'),
  metric_input: z
    .record(z.unknown())
    .optional()
    .describe('Updated metric inputs.'),
  user_notes: z
    .string()
    .optional()
    .describe('Updated internal notes.'),
});

export type ListTestCasesInput = z.infer<typeof ListTestCasesInputSchema>;
export type GetTestCaseInput = z.infer<typeof GetTestCaseInputSchema>;
export type CreateTestCaseInput = z.infer<typeof CreateTestCaseInputSchema>;
export type UpdateTestCaseInput = z.infer<typeof UpdateTestCaseInputSchema>;
