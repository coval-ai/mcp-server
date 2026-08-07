import { z } from 'zod';
import { ResourceIdSchema } from './common.js';

const ReportPaginationShape = {
  page_size: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Number of reports to return (1-100, default 50).'),
  page_token: z
    .string()
    .max(2048)
    .regex(/^\d+$/, 'Report page token must contain only digits')
    .optional()
    .describe('Token for retrieving the next page of reports.'),
};

export const ListReportsInputSchema = z.object(ReportPaginationShape).strict();
export const LegacyListReportsInputSchema = z.object(ReportPaginationShape);

export const GetReportInputSchema = z.object({
  report_id: ResourceIdSchema.describe('The unique ID of the report to retrieve.'),
  page_size: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Number of report rows to return (1-100, default 20).'),
  page_token: z
    .string()
    .max(2048)
    .regex(/^\d+$/, 'Report row page token must contain only digits')
    .optional()
    .describe('Token for retrieving the next page of report rows.'),
  metric_ids: z
    .array(ResourceIdSchema)
    .max(20)
    .optional()
    .describe('Optional metric IDs used to limit the returned report row data (max 20).'),
}).strict();

export const ReportCompareBySchema = z.enum([
  'none',
  'run',
  'agent',
  'mutation',
  'persona',
  'test_case',
  'metadata',
]);

export const CreateReportInputSchema = z.object({
  name: z.string().trim().min(1).max(200).describe('Name for the saved report.'),
  run_ids: z
    .array(ResourceIdSchema)
    .min(1)
    .max(200)
    .describe('Evaluation run IDs to include (1-200).'),
  compare_by: ReportCompareBySchema.optional().describe(
    'Optional dimension used to compare report results.',
  ),
  metadata_key: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe('Metadata key used when compare_by is metadata.'),
  view_mode: z
    .enum(['rows', 'grouped'])
    .optional()
    .describe('Optional report presentation mode.'),
}).strict().superRefine((value, context) => {
  if (value.compare_by === 'metadata' && !value.metadata_key) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['metadata_key'],
      message: 'metadata_key is required when compare_by is metadata',
    });
  }
  if (value.compare_by !== 'metadata' && value.metadata_key) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['metadata_key'],
      message: 'metadata_key is only allowed when compare_by is metadata',
    });
  }
});

export type ListReportsInput = z.infer<typeof ListReportsInputSchema>;
export type LegacyListReportsInput = z.infer<typeof LegacyListReportsInputSchema>;
export type GetReportInput = z.infer<typeof GetReportInputSchema>;
export type CreateReportInput = z.infer<typeof CreateReportInputSchema>;
