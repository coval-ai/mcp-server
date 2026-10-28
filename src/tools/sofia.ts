import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CovalApiClient } from '../client.js';
import { createSuccessResponse } from '../utils/response.js';
import { handleApiError } from '../utils/errors.js';
import { TranscriptExportError, type TranscriptExport } from '../transcript-exports.js';
import {
  readOnlyTool,
  type ToolInputProfile,
} from './annotations.js';

const SofiaConsultInputSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(4000)
    .describe(
      'A standalone, task-specific Coval evaluation question for Sofia. Include only the exact facts needed for this request, never conversation history.',
    ),
}).strict();

const LegacySofiaConsultInputSchema = z.object({
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(12000)
    .describe('The question or task to delegate to Sofia.'),
  conversation: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(12000),
      }),
    )
    .max(12)
    .optional()
    .describe(
      'Optional prior turns needed for the current request. Do not include secrets or API keys.',
    ),
  session_id: z
    .string()
    .regex(/^[A-Za-z0-9._:-]+$/)
    .max(128)
    .optional()
    .describe('Optional stable caller-session identifier. It must not contain customer secrets.'),
});

export function registerSofiaTools(
  server: McpServer,
  client: CovalApiClient,
  {
    inputProfile = 'legacy',
  }: {
    inputProfile?: ToolInputProfile;
  } = {},
) {
  server.registerTool(
    'consult_sofia',
    {
      ...readOnlyTool('Consult Sofia'),
      description:
        inputProfile === 'openai'
          ? "Delegate one standalone, read-only Coval evaluation question to Sofia. Sofia can inspect the authenticated organization's evaluation resources, including runs, simulated conversations, and uploaded conversations, but this tool never requests ChatGPT conversation history. It cannot create, modify, run, or delete anything."
          : "Delegate a read-only Coval evaluation question to Sofia. Sofia can use Coval playbooks and the authenticated organization's runs, simulated conversations, uploaded conversations, metrics, agents, personas, test sets, and dashboards. It cannot create, modify, run, or delete anything.",
      inputSchema:
        inputProfile === 'openai'
          ? SofiaConsultInputSchema
          : LegacySofiaConsultInputSchema,
    },
    async (params: {
      prompt: string;
      conversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
      session_id?: string;
    }) => {
      try {
        const input = params as {
          prompt: string;
          conversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
          session_id?: string;
        };
        const result = await client.consultSofia({
          prompt: input.prompt,
          ...(inputProfile === 'legacy'
            ? {
                conversation: input.conversation,
                sessionId: input.session_id,
              }
            : {}),
        });
        let summary = result.summary;
        const exports: TranscriptExport[] = [];
        const exportErrors: Array<{ status: 'failed'; run_id: string; message: string }> = [];
        for (const request of result.exportRequests ?? []) {
          try {
            exports.push(await client.prepareRunTranscriptExport(request.run_id));
          } catch (error) {
            exportErrors.push({ status: 'failed', run_id: request.run_id, message: error instanceof TranscriptExportError ? error.message : 'Complete transcript collection or authorization failed; no incomplete export was attached.' });
          }
        }
        if (exportErrors.length) {
          summary = `Transcript export delivery failed. No complete export is attached. ${exportErrors.map((error) => error.message).join(' ')}`;
        } else if (exports.length) {
          const artifact = exports[0];
          summary = `Complete transcript export prepared: ${artifact.call_count} calls (${artifact.available_count} available, ${artifact.unavailable_count} explicitly unavailable). Read the attached authenticated resource, or use read_transcript_export until complete=true.`;
        }
        const response = createSuccessResponse({
          contract_version: result.contractVersion,
          mode: result.mode,
          summary,
          evidence: result.evidence,
          proposed_actions: result.proposedActions,
          ...(exports.length ? { exports } : {}),
          ...(exportErrors.length ? { export_errors: exportErrors } : {}),
        });
        response.content.push(...exports.map((artifact) => ({
          type: 'resource_link' as const, uri: artifact.uri, name: artifact.name,
          mimeType: artifact.mimeType, size: artifact.size,
          description: 'Complete current-read transcript export. Default workspace; reauthorized on every read. Source changes are reported explicitly.',
        })));
        return response;
      } catch (err) {
        return handleApiError(err);
      }
    },
  );
}
