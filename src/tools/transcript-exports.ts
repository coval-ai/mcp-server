import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CovalApiClient } from '../client.js';
import { readOnlyTool } from './annotations.js';
import { createErrorResponse, createSuccessResponse } from '../utils/response.js';
import { TranscriptExportError } from '../transcript-exports.js';
import { handleApiError } from '../utils/errors.js';

export function registerTranscriptExports(server: McpServer, client: CovalApiClient): void {
  server.registerResource(
    'run-transcripts',
    new ResourceTemplate('coval://run-transcripts/{run_id}/{snapshot}', { list: undefined }),
    {
      title: 'Complete run transcripts',
      mimeType: 'application/json',
      description: 'Authenticated Default-workspace transcripts with timing, tool ownership and explicit unavailable reasons. Current API reads are checked against the prepared manifest.',
    },
    async (uri) => {
      try {
        const result = await client.readRunTranscriptExport(uri.toString());
        return { contents: [{ uri: uri.toString(), mimeType: 'application/json', text: result.text }] };
      } catch (error) {
        throw new Error(error instanceof TranscriptExportError ? error.message : 'Transcript export could not be read with current authorization');
      }
    },
  );
  server.registerTool(
    'read_transcript_export',
    {
      ...readOnlyTool('Read a transcript export'),
      description: 'Read an authenticated transcript export when resource links are unavailable. Concatenate text fragments exactly, then JSON-decode the completed document. Continue with next_offset and the returned version until complete=true. A changed version refuses continuation rather than mixing transcripts. URI manifests are not authorization; each read uses current Coval access.',
      inputSchema: {
        uri: z.string().max(60_000),
        offset: z.number().int().min(0).max(2 ** 31 - 1).optional(),
        max_chars: z.number().int().min(1).max(65_536).optional(),
        expected_version: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
      },
    },
    async ({ uri, offset = 0, max_chars = 4000, expected_version }) => {
      try {
        if (offset > 0 && !expected_version) throw new TranscriptExportError('Continuation requires the previous version');
        const result = await client.readRunTranscriptExport(uri);
        if (expected_version !== undefined && expected_version !== result.version) {
          throw new TranscriptExportError('Transcript export source changed; restart the export instead of combining versions');
        }
        if (offset > result.text.length) throw new TranscriptExportError('Transcript export offset is out of range');
        const end = Math.min(offset + max_chars, result.text.length);
        return createSuccessResponse({
          uri, version: result.version, offset, next_offset: end < result.text.length ? end : null,
          offset_unit: 'utf16_code_units', text: result.text.slice(offset, end),
          complete: end === result.text.length, total_chars: result.text.length,
        });
      } catch (error) {
        return error instanceof TranscriptExportError
          ? createErrorResponse('TRANSCRIPT_EXPORT_UNAVAILABLE', error.message)
          : handleApiError(error);
      }
    },
  );
}
