import { z } from 'zod';
import { ResourceIdSchema } from './common.js';

export const PROJECT_CONVERSATION_PAGE_SIZE = 30;
export const PROJECT_METRIC_PAGE_SIZE = 25;
export const TRANSCRIPT_PAGE_SIZE = 8000;

const workspaceId = ResourceIdSchema.max(26).optional().describe(
  'Workspace ID. Defaults to the authorized organization’s default workspace.',
);
const projectId = ResourceIdSchema.describe('ID of the existing Human Review project.');
const conversationId = ResourceIdSchema.describe('Conversation ID linked to this review project.');

export const ListReviewProjectsInputSchema = z.object({
  workspace_id: workspaceId,
  page_size: z.number().int().min(1).max(25).optional().describe('Projects per page (default 15).'),
  page_token: z.string().max(2048).optional().describe('Continuation token from the previous page.'),
}).strict();

export const GetReviewProjectInputSchema = z.object({
  project_id: projectId,
  workspace_id: workspaceId,
  conversation_offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - PROJECT_CONVERSATION_PAGE_SIZE).optional()
    .describe('Zero-based offset from next_conversation_offset to read more linked conversation IDs.'),
  metric_offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - PROJECT_METRIC_PAGE_SIZE).optional()
    .describe('Zero-based offset from next_metric_offset to read more linked metric IDs.'),
}).strict();

export const GetReviewConversationInputSchema = z.object({
  project_id: projectId,
  simulation_output_id: conversationId,
  workspace_id: workspaceId,
  transcript_offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - TRANSCRIPT_PAGE_SIZE).optional()
    .describe('Character offset from next_transcript_offset to continue reading.'),
}).strict();

function validJson(input: string, validate: (value: unknown) => boolean): boolean {
  try {
    return validate(JSON.parse(input, (_key, value: unknown) => {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new RangeError('Non-finite JSON number');
      return value;
    }));
  } catch {
    return false;
  }
}

const answerFields = {
  ground_truth_float_value: z.number().finite().nullable().optional().describe('The reviewer’s numeric answer.'),
  ground_truth_string_value: z.string().max(4000).nullable().optional().describe('The reviewer’s text or categorical answer.'),
  ground_truth_set_value: z.array(z.string().max(500)).max(50).nullable().optional().describe('The reviewer’s set of selected labels.'),
  ground_truth_json: z.string().min(1).max(8000)
    .refine((value) => validJson(value, (parsed) => parsed !== null), 'Expected a non-null JSON value.')
    .nullable().optional().describe('The reviewer’s structured answer, encoded as JSON text.'),
  ground_truth_subvalues_by_timestamp: z.string().min(1).max(8000)
    .refine((value) => validJson(value, (parsed) => Array.isArray(parsed) && parsed.every(
      (item: unknown) => typeof item === 'object' && item !== null && !Array.isArray(item),
    )), 'Expected a JSON array of timestamped answer objects.')
    .nullable().optional().describe('The reviewer’s timestamped answers, encoded as a JSON array.'),
  reviewer_notes: z.string().max(4000).optional().describe('Notes provided by the reviewer. Use an empty string to clear notes.'),
};

const answerKeys = Object.keys(answerFields) as Array<keyof typeof answerFields>;

export const CreateReviewAnnotationInputSchema = z.object({
  project_id: projectId,
  simulation_output_id: conversationId,
  metric_id: ResourceIdSchema.describe('The linked review metric ID.'),
  workspace_id: workspaceId,
  ...answerFields,
}).strict().refine((value) => answerKeys.some((key) => value[key] != null), {
  message: 'Provide at least one non-null reviewer answer or note.',
});

export const UpdateReviewAnnotationInputSchema = z.object({
  project_id: projectId,
  annotation_id: ResourceIdSchema.describe('The saved annotation ID returned when the answer was recorded.'),
  workspace_id: workspaceId,
  ...answerFields,
}).strict().refine((value) => answerKeys.some((key) => value[key] !== undefined), {
  message: 'Provide at least one field to change.',
});

export const CompleteReviewConversationInputSchema = z.object({
  project_id: projectId,
  simulation_output_id: conversationId,
  workspace_id: workspaceId,
}).strict();
