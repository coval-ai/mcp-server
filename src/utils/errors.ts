import { CovalApiError } from '../client.js';
import { createErrorResponse } from './response.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function handleApiError(err: unknown): CallToolResult {
  if (err instanceof CovalApiError) {
    let suggestion: string | undefined;

    switch (err.code) {
      case 'NOT_FOUND':
        suggestion = 'Use the corresponding list tool to find valid IDs.';
        break;
      case 'UNAUTHENTICATED':
        suggestion = 'Check that your COVAL_API_KEY is valid.';
        break;
      case 'INVALID_ARGUMENT':
        suggestion = 'Check the input parameters and try again.';
        break;
    }

    return createErrorResponse(err.code, err.message, suggestion);
  }

  if (err instanceof Error) {
    return createErrorResponse('INTERNAL_ERROR', err.message);
  }

  return createErrorResponse('UNKNOWN_ERROR', 'An unexpected error occurred');
}
