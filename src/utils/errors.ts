import { CovalApiError } from '../client.js';
import { createErrorResponse } from './response.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const SAFE_API_ERRORS = new Map<string, { message: string; suggestion?: string }>([
  [
    'NOT_FOUND',
    {
      message: 'The requested resource was not found.',
      suggestion: 'Use the corresponding list tool to find valid IDs.',
    },
  ],
  [
    'UNAUTHENTICATED',
    {
      message: 'Authentication failed.',
      suggestion: 'Reconnect or verify your Coval credentials.',
    },
  ],
  [
    'INVALID_ARGUMENT',
    {
      message: 'The request contained invalid arguments.',
      suggestion: 'Check the input parameters and try again.',
    },
  ],
  [
    'PERMISSION_DENIED',
    {
      message: 'The authenticated identity does not have permission for this request.',
    },
  ],
  [
    'ALREADY_EXISTS',
    {
      message: 'The requested resource already exists.',
      suggestion: 'Use a different identifier or update the existing resource.',
    },
  ],
  [
    'CONFLICT',
    {
      message: 'The request conflicts with the current resource state.',
      suggestion: 'Refresh the resource and try again.',
    },
  ],
  [
    'FAILED_PRECONDITION',
    {
      message: 'A required precondition was not met.',
      suggestion: 'Check the resource state and required setup before trying again.',
    },
  ],
  [
    'PAYLOAD_TOO_LARGE',
    {
      message: 'The request payload is too large.',
      suggestion: 'Reduce the request size and try again.',
    },
  ],
  [
    'INTERNAL',
    {
      message: 'The Coval API could not complete the request.',
      suggestion: 'Try the request again later.',
    },
  ],
  [
    'COVI_UNAVAILABLE',
    {
      message: 'Sofia is temporarily unavailable.',
      suggestion: 'Try the request again later.',
    },
  ],
  [
    'INVALID_PROMPT',
    {
      message: 'The Sofia request prompt was invalid.',
      suggestion: 'Revise the prompt and try again.',
    },
  ],
  [
    'INVALID_DELEGATION',
    {
      message: 'Sofia delegation could not be validated.',
    },
  ],
  [
    'INVALID_COVI_RESPONSE',
    {
      message: 'Sofia returned an invalid response.',
    },
  ],
]);

export function handleApiError(err: unknown): CallToolResult {
  if (err instanceof CovalApiError) {
    const safeError = SAFE_API_ERRORS.get(err.code);
    if (safeError) {
      return createErrorResponse(err.code, safeError.message, safeError.suggestion);
    }
    return createErrorResponse('API_ERROR', 'The Coval API request failed.');
  }

  if (err instanceof Error) {
    return createErrorResponse('INTERNAL_ERROR', 'An unexpected error occurred.');
  }

  return createErrorResponse('UNKNOWN_ERROR', 'An unexpected error occurred.');
}
