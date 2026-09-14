import { z } from 'zod';
import { ResourceIdSchema } from './common.js';

export const IssueStatusSchema = z.enum([
  'needs_review',
  'confirmed',
  'clearing',
  'resolved',
  'closed_manual',
  'dismissed',
  'merged',
]);
export const IssueSeveritySchema = z.enum(['critical', 'high', 'medium', 'low']);
export const IssueActionSchema = z.enum([
  'confirm',
  'assign',
  'dismiss',
  'merge',
  'attach_suite',
  'record_change',
  'set_clearance_policy',
  'start_clearance',
  'close_manual',
  'reopen',
]);

export const ClearancePolicySchema = z
  .object({
    success_rate_min: z
      .number()
      .gt(0)
      .max(1)
      .describe('Required pass rate over valid simulations, e.g. 0.98. Customers choose; there is no default.'),
    min_valid_simulations: z
      .number()
      .int()
      .min(1)
      .describe('Minimum completed, fully graded simulations the clearance run must contain.'),
    required_metric_ids: z
      .array(ResourceIdSchema)
      .min(1)
      .describe('Metrics that must pass on every counted simulation.'),
    required_test_case_ids: z
      .array(ResourceIdSchema)
      .optional()
      .describe('Test cases that must each have at least one valid simulation.'),
  })
  .strict();

const ListIssuesShape = {
  status: z
    .array(IssueStatusSchema)
    .optional()
    .describe('Filter to these statuses. Omit for the whole board.'),
  owner: z
    .string()
    .max(200)
    .optional()
    .describe("Owner user id, or 'me' for the caller's queue."),
  agent_id: ResourceIdSchema.optional().describe('Only issues affecting this agent.'),
  page_size: z.number().int().min(1).max(100).optional().describe('Issues to return (1-100, default 50).'),
};

export const ListIssuesInputSchema = z.object(ListIssuesShape).strict();
export const LegacyListIssuesInputSchema = z.object(ListIssuesShape);

export const GetIssueInputSchema = z
  .object({ issue_id: ResourceIdSchema.describe('The issue to retrieve, with its activity and clearance attempts.') })
  .strict();

export const CreateIssueInputSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    finding_id: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .optional()
      .describe('Sofia investigation finding this issue is created from. Repeated sightings link here rather than opening a duplicate.'),
    agent_id: ResourceIdSchema.optional(),
    severity: IssueSeveritySchema.optional(),
    failure_pattern: z.string().max(100).optional(),
    expected_behavior: z.string().max(5000).optional(),
    observed_behavior: z.string().max(5000).optional(),
    business_outcome: z.string().max(200).optional().describe('Outcome the issue affects, e.g. "bookings" or "successful handoff".'),
  })
  .strict();

export const IssueActionInputSchema = z
  .object({
    issue_id: ResourceIdSchema,
    action: IssueActionSchema,
    expected_version: z
      .number()
      .int()
      .min(1)
      .describe('The issue version you last read. A stale value is rejected so two people cannot overwrite each other.'),
    note: z.string().max(2000).optional(),
    owner_user_id: z.string().max(200).optional().describe('assign: the new owner.'),
    severity: IssueSeveritySchema.optional().describe('confirm: severity to record.'),
    suite_test_set_id: ResourceIdSchema.optional().describe('attach_suite: the focused test set that asks "did we fix this?"'),
    clearance_policy: ClearancePolicySchema.optional().describe('set_clearance_policy: the tolerance to freeze per attempt.'),
    run_id: ResourceIdSchema.optional().describe('start_clearance: a run of the attached suite to judge. Launch it with launch_run first.'),
    merged_into_id: ResourceIdSchema.optional().describe('merge: the surviving issue.'),
    agent_version_id: z.string().max(64).optional().describe('record_change: the agent version the change was tested on.'),
    external_ticket_url: z.string().url().max(2000).optional(),
    external_ticket_label: z.string().max(200).optional(),
  })
  .strict();

export const IssuesSummaryInputSchema = z
  .object({
    period: z.enum(['week', 'month', 'quarter']).optional().describe('Bucket width for the resolution history (default week).'),
    buckets: z.number().int().min(1).max(24).optional().describe('How many trailing periods to chart (default 8).'),
  })
  .strict();

export const ListRegressionSuiteInputSchema = z
  .object({ agent_id: ResourceIdSchema.optional().describe('Only this agent\'s baseline.') })
  .strict();

export type ListIssuesInput = z.infer<typeof ListIssuesInputSchema>;
export type LegacyListIssuesInput = z.infer<typeof LegacyListIssuesInputSchema>;
export type GetIssueInput = z.infer<typeof GetIssueInputSchema>;
export type CreateIssueInput = z.infer<typeof CreateIssueInputSchema>;
export type IssueActionInput = z.infer<typeof IssueActionInputSchema>;
export type IssuesSummaryInput = z.infer<typeof IssuesSummaryInputSchema>;
export type ListRegressionSuiteInput = z.infer<typeof ListRegressionSuiteInputSchema>;
