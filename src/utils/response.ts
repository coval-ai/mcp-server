import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function createSuccessResponse(data: unknown): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function createErrorResponse(
  code: string,
  message: string,
  suggestion?: string
): CallToolResult {
  const error: Record<string, unknown> = {
    error: code,
    message,
  };
  if (suggestion) {
    error.suggestion = suggestion;
  }
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(error, null, 2),
      },
    ],
    isError: true,
  };
}
