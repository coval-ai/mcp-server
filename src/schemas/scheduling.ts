import { z } from 'zod';
import { ResourceIdSchema } from './common.js';

const ScheduleExpressionSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(
    /^(?:rate|cron)\(.+\)$/,
    'Schedule expression must use rate(...) or cron(...) syntax',
  );

const ScheduleTimezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(
    /^[A-Za-z0-9._+-]+(?:\/[A-Za-z0-9._+-]+)*$/,
    'Schedule timezone must be UTC or an IANA-style timezone name',
  );

const RunTemplatePaginationShape = {
  page_size: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Number of run templates to return (1-100, default 50).'),
  page_token: z
    .string()
    .max(2048)
    .optional()
    .describe('Token for retrieving the next page of run templates.'),
};

export const ListRunTemplatesInputSchema = z
  .object(RunTemplatePaginationShape)
  .strict();
export const LegacyListRunTemplatesInputSchema = z.object(
  RunTemplatePaginationShape,
);

const ScheduledRunPaginationShape = {
  page_size: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Number of scheduled runs to return (1-100, default 50).'),
  page_token: z
    .string()
    .max(2048)
    .optional()
    .describe('Token for retrieving the next page of scheduled runs.'),
  enabled: z
    .boolean()
    .optional()
    .describe('Filter scheduled runs by enabled state.'),
  template_id: ResourceIdSchema.optional().describe(
    'Filter scheduled runs by run template ID.',
  ),
};

export const ListScheduledRunsInputSchema = z
  .object(ScheduledRunPaginationShape)
  .strict();
export const LegacyListScheduledRunsInputSchema = z.object(
  ScheduledRunPaginationShape,
);

export const GetScheduledRunInputSchema = z.object({
  scheduled_run_id: ResourceIdSchema.describe(
    'The unique ID of the scheduled run to retrieve.',
  ),
  history_size: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Number of recent triggered runs to return (1-100, default 20).'),
  history_page_token: z
    .string()
    .regex(/^\d{1,3}$/, 'History page token must contain one to three digits')
    .refine((value) => Number(value) < 500, {
      message: 'History page token must be less than 500',
    })
    .optional()
    .describe('Token for continuing within the API history window.'),
}).strict();

export const CreateScheduledRunInputSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe('Display name for the scheduled run.'),
  run_template_id: ResourceIdSchema.describe(
    'Run template executed by the schedule.',
  ),
  schedule_expression: ScheduleExpressionSchema.describe(
    'AWS-style rate(...) or cron(...) schedule expression.',
  ),
  schedule_timezone: ScheduleTimezoneSchema.optional().describe(
    'Timezone for cron schedules, such as UTC or America/Los_Angeles.',
  ),
  enabled: z
    .boolean()
    .optional()
    .describe('Whether to activate the schedule immediately. Defaults to false.'),
}).strict().superRefine((value, context) => {
  if (value.schedule_expression.startsWith('cron(') && !value.schedule_timezone) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['schedule_timezone'],
      message: 'schedule_timezone is required for cron schedules',
    });
  }
});

export const UpdateScheduledRunInputSchema = z.object({
  scheduled_run_id: ResourceIdSchema.describe(
    'The unique ID of the scheduled run to update.',
  ),
  display_name: z.string().trim().min(1).max(200).optional(),
  run_template_id: ResourceIdSchema.optional(),
  schedule_expression: ScheduleExpressionSchema.optional(),
  schedule_timezone: ScheduleTimezoneSchema.optional(),
  enabled: z.boolean().optional(),
}).strict().superRefine((value, context) => {
  if (
    value.display_name === undefined &&
    value.run_template_id === undefined &&
    value.schedule_expression === undefined &&
    value.schedule_timezone === undefined &&
    value.enabled === undefined
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one scheduled run field must be provided',
    });
  }
  if (
    value.schedule_expression?.startsWith('cron(') &&
    !value.schedule_timezone
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['schedule_timezone'],
      message: 'schedule_timezone is required when changing to a cron schedule',
    });
  }
});

export type ListRunTemplatesInput = z.infer<typeof ListRunTemplatesInputSchema>;
export type LegacyListRunTemplatesInput = z.infer<
  typeof LegacyListRunTemplatesInputSchema
>;
export type ListScheduledRunsInput = z.infer<typeof ListScheduledRunsInputSchema>;
export type LegacyListScheduledRunsInput = z.infer<
  typeof LegacyListScheduledRunsInputSchema
>;
export type GetScheduledRunInput = z.infer<typeof GetScheduledRunInputSchema>;
export type CreateScheduledRunInput = z.infer<typeof CreateScheduledRunInputSchema>;
export type UpdateScheduledRunInput = z.infer<typeof UpdateScheduledRunInputSchema>;
