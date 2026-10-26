import { z } from 'zod';

const DraftIdSchema = z.string().min(1).describe('The immutable Python metric draft ID.');
const PreviewIdSchema = z.string().min(1).describe('The asynchronous preview ID.');

export const CreatePythonMetricDraftInputSchema = z.object({
  target_metric_id: z.string().nullable().optional(),
  target_version_id: z.string().nullable().optional(),
  display_name: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  source: z.string().min(1).max(65536),
  output_type: z.enum(['number', 'boolean']),
  unit: z.string().max(64).nullable().optional(),
  requirements: z
    .object({
      audio: z.boolean().optional(),
      traces: z.boolean().optional(),
      frame_tables: z.array(z.string()).max(32).optional(),
    })
    .strict()
    .optional(),
}).strict();

export const GetPythonMetricDraftInputSchema = z.object({
  draft_id: DraftIdSchema,
}).strict();

export const CreatePythonMetricPreviewInputSchema = z.object({
  draft_id: DraftIdSchema,
  simulation_output_ids: z.array(z.string()).length(1),
}).strict();

export const GetPythonMetricPreviewInputSchema = z.object({
  draft_id: DraftIdSchema,
  preview_id: PreviewIdSchema,
}).strict();

export const CancelPythonMetricPreviewInputSchema = z.object({
  draft_id: DraftIdSchema,
  preview_id: PreviewIdSchema,
}).strict();

export const PublishPythonMetricDraftInputSchema = z.object({
  draft_id: DraftIdSchema,
  preview_ids: z.array(z.string()).min(1).max(10),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export type CreatePythonMetricDraftInput = z.infer<
  typeof CreatePythonMetricDraftInputSchema
>;
export type GetPythonMetricDraftInput = z.infer<typeof GetPythonMetricDraftInputSchema>;
export type CreatePythonMetricPreviewInput = z.infer<
  typeof CreatePythonMetricPreviewInputSchema
>;
export type GetPythonMetricPreviewInput = z.infer<
  typeof GetPythonMetricPreviewInputSchema
>;
export type CancelPythonMetricPreviewInput = z.infer<
  typeof CancelPythonMetricPreviewInputSchema
>;
export type PublishPythonMetricDraftInput = z.infer<
  typeof PublishPythonMetricDraftInputSchema
>;
