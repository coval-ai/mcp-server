import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CovalApiClient } from '../client.js';
import {
  CreateIssueInputSchema,
  GetIssueInputSchema,
  IssueActionInputSchema,
  IssuesSummaryInputSchema,
  LegacyListIssuesInputSchema,
  ListIssuesInputSchema,
  ListRegressionSuiteInputSchema,
  type CreateIssueInput,
  type GetIssueInput,
  type IssueActionInput,
  type IssuesSummaryInput,
  type LegacyListIssuesInput,
  type ListIssuesInput,
  type ListRegressionSuiteInput,
} from '../schemas/index.js';
import { handleApiError } from '../utils/errors.js';
import { createSuccessResponse } from '../utils/response.js';
import {
  createTool,
  readOnlyTool,
  updateTool,
  type ToolAnnotationProfile,
  type ToolInputProfile,
} from './annotations.js';

// Issues are the agent improvement loop: a finding becomes an owned issue, the owner
// iterates against a focused suite, an explicit clearance policy verifies the fix, and the
// proven suite joins the regression baseline. These tools expose exactly the lifecycle the
// UI, API, and CLI expose, so an agent driving the loop sees the same statuses and errors.
export function registerIssueTools(
  server: McpServer,
  client: CovalApiClient,
  {
    annotationProfile = 'standard',
    inputProfile = 'legacy',
  }: {
    annotationProfile?: ToolAnnotationProfile;
    inputProfile?: ToolInputProfile;
  } = {},
) {
  server.registerTool(
    'list_issues',
    {
      ...readOnlyTool('List issues'),
      description:
        'List agent issues on the improvement board. Filter by status (needs_review, confirmed, clearing, resolved, ...), owner ("me" for your queue), or agent.',
      inputSchema: inputProfile === 'openai' ? ListIssuesInputSchema : LegacyListIssuesInputSchema,
    },
    async (params: ListIssuesInput | LegacyListIssuesInput) => {
      try {
        return createSuccessResponse(await client.listIssues(params));
      } catch (err) {
        return handleApiError(err);
      }
    },
  );

  server.registerTool(
    'get_issue',
    {
      ...readOnlyTool('Get issue'),
      description:
        'Retrieve one issue with its full activity log (confirmation, assignment, recorded changes, clearance attempts, verified resolution, recurrences).',
      inputSchema: GetIssueInputSchema,
    },
    async (params: GetIssueInput) => {
      try {
        return createSuccessResponse(await client.getIssue(params.issue_id));
      } catch (err) {
        return handleApiError(err);
      }
    },
  );

  server.registerTool(
    'create_issue',
    {
      ...createTool('Create issue', { annotationProfile }),
      description:
        'Create an issue, normally from a Sofia investigation finding. It enters needs_review; a person confirms it to start the loop. A finding already tracked returns a conflict pointing at its issue.',
      inputSchema: CreateIssueInputSchema,
    },
    async (params: CreateIssueInput) => {
      try {
        return createSuccessResponse(await client.createIssue(params));
      } catch (err) {
        return handleApiError(err);
      }
    },
  );

  server.registerTool(
    'issue_action',
    {
      ...updateTool('Apply issue action'),
      description:
        'Move an issue through its lifecycle: confirm, assign, attach_suite, set_clearance_policy, record_change, start_clearance (judges a completed run against the frozen policy; a pass resolves the issue and promotes the suite to the regression baseline), close_manual, dismiss, merge, reopen. Requires the expected_version you last read.',
      inputSchema: IssueActionInputSchema,
    },
    async (params: IssueActionInput) => {
      try {
        const { issue_id, ...body } = params;
        return createSuccessResponse(await client.applyIssueAction(issue_id, body));
      } catch (err) {
        return handleApiError(err);
      }
    },
  );

  server.registerTool(
    'get_issues_summary',
    {
      ...readOnlyTool('Get improvement summary'),
      description:
        'The improvement view: issues needing review, confirmed open, verified resolved in the window, recurrences, resolutions by week/month/quarter, confirmation-to-resolution time, and unresolved age. Verified resolutions only; manual closures and dismissals are excluded.',
      inputSchema: IssuesSummaryInputSchema,
    },
    async (params: IssuesSummaryInput) => {
      try {
        return createSuccessResponse(await client.getIssuesSummary(params));
      } catch (err) {
        return handleApiError(err);
      }
    },
  );

  server.registerTool(
    'list_regression_suite',
    {
      ...readOnlyTool('List regression baseline'),
      description:
        "List the test sets protecting an agent's established behavior, with provenance (verified resolution or manually labelled), the proven test-set version, and the issue each one traces back to.",
      inputSchema: ListRegressionSuiteInputSchema,
    },
    async (params: ListRegressionSuiteInput) => {
      try {
        return createSuccessResponse(await client.listRegressionSuite(params));
      } catch (err) {
        return handleApiError(err);
      }
    },
  );
}
