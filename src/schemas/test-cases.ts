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

// Mirrors the /v1 script-turn wire union so malformed turns are rejected at this
// boundary instead of round-tripping to a 400. Digits take the API charset —
// keypad characters plus phone punctuation for full numbers, which telephony
// transports render as brief pauses — and must contain at least one key.
const DtmfDigitsSchema = z
  .string()
  .regex(/^[0-9#*+(). -]+$/, 'digits allow 0-9, *, # and phone punctuation')
  .regex(/[0-9#*]/, 'digits must contain at least one keypad character');

const ScriptTurnSchema = z.union([
  z.string().min(1),
  z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: z.string().min(1) }).strict(),
    z.object({ type: z.literal('dtmf'), digits: DtmfDigitsSchema }).strict(),
    z.object({ type: z.literal('skip') }).strict(),
  ]),
]);

// Free-form simulation metadata: arbitrary sibling keys pass through, but a
// script_turns entry is validated against the wire union.
const SimulationMetadataInputSchema = z
  .object({ script_turns: z.array(ScriptTurnSchema).optional() })
  .passthrough();

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
  input_type: z
    .enum(['SCENARIO', 'TRANSCRIPT', 'IVR', 'AUDIO', 'MANUAL', 'SCRIPT'])
    .optional()
    .describe('Input type; defaults to SCENARIO. Use SCRIPT with simulation_metadata_input.script_turns for exact ordered turns.'),
  simulation_metadata_input: SimulationMetadataInputSchema
    .optional()
    .describe(
      'Additional context passed to the simulation environment. For scripted (input_type SCRIPT) cases, set {"script_turns": [...]} here: entries are plain strings the persona speaks verbatim, or typed keypad presses {"type": "dtmf", "digits": "1"} (digits allow 0-9, *, # plus phone punctuation for full numbers). Never write DTMF as spoken text like "dtmf:1" — it would be read aloud. For SCENARIO cases against IVRs, instead instruct the persona in input_str to use its dtmf_tool for each keypress.',
    ),
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
  input_type: z
    .enum(['SCENARIO', 'TRANSCRIPT', 'IVR', 'AUDIO', 'MANUAL', 'SCRIPT'])
    .optional()
    .describe('Updated input type. Switching away from SCRIPT clears stored script_turns.'),
  script_turns: z
    .array(ScriptTurnSchema)
    .optional()
    .describe(
      'Replacement turn list, merged into stored simulation metadata server-side (sibling keys preserved). '
      + 'Preferred over simulation_metadata_input for turn edits. Entries: plain strings the persona speaks '
      + 'verbatim, or typed keypad presses {"type": "dtmf", "digits": "1"} (digits allow 0-9, *, # plus phone '
      + 'punctuation for full numbers). Never write DTMF as spoken text like "dtmf:1". When sent together with '
      + 'simulation_metadata_input, that object is replaced first and these turns are then merged into the '
      + 'result, so this field always wins for the script_turns key.',
    ),
  simulation_metadata_input: SimulationMetadataInputSchema
    .optional()
    .describe(
      'Updated simulation context. Replaces the stored object wholesale — include every key you want to keep. Prefer the top-level script_turns field for turn edits; if both are sent, this object is replaced first and script_turns is merged into the result. For scripted (input_type SCRIPT) cases you may set {"script_turns": [...]} here instead: entries are plain strings the persona speaks verbatim, or typed keypad presses {"type": "dtmf", "digits": "1"} (digits allow 0-9, *, # plus phone punctuation for full numbers). Never write DTMF as spoken text like "dtmf:1" — it would be read aloud. For SCENARIO cases against IVRs, instead instruct the persona in input_str to use its dtmf_tool for each keypress.',
    ),
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
