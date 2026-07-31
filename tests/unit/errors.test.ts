import { CovalApiError } from '../../src/client.js';
import { handleApiError } from '../../src/utils/errors.js';

function errorPayload(error: unknown): Record<string, unknown> {
  const result = handleApiError(error);
  const content = result.content[0];
  if (content?.type !== 'text') throw new Error('Expected a text tool response');
  return JSON.parse(content.text) as Record<string, unknown>;
}

describe('handleApiError', () => {
  it('uses a code-based response for known API errors', () => {
    const payload = errorPayload(
      new CovalApiError(
        'NOT_FOUND',
        'FAKE_SENSITIVE_UPSTREAM_MESSAGE',
        [{ description: 'FAKE_SENSITIVE_UPSTREAM_DETAIL' }],
        404
      )
    );

    expect(payload).toEqual({
      error: 'NOT_FOUND',
      message: 'The requested resource was not found.',
      suggestion: 'Use the corresponding list tool to find valid IDs.',
    });
    expect(JSON.stringify(payload)).not.toContain('FAKE_SENSITIVE');
  });

  it.each([
    [
      'UNAUTHENTICATED',
      401,
      {
        error: 'UNAUTHENTICATED',
        message: 'Authentication failed.',
        suggestion: 'Reconnect or verify your Coval credentials.',
      },
    ],
    [
      'INVALID_ARGUMENT',
      400,
      {
        error: 'INVALID_ARGUMENT',
        message: 'The request contained invalid arguments.',
        suggestion: 'Check the input parameters and try again.',
      },
    ],
    [
      'PERMISSION_DENIED',
      403,
      {
        error: 'PERMISSION_DENIED',
        message: 'The authenticated identity does not have permission for this request.',
      },
    ],
    [
      'SOFIA_UNAVAILABLE',
      503,
      {
        error: 'SOFIA_UNAVAILABLE',
        message: 'Sofia is temporarily unavailable.',
        suggestion: 'Try the request again later.',
      },
    ],
    [
      'COVI_UNAVAILABLE',
      503,
      {
        error: 'COVI_UNAVAILABLE',
        message: 'Sofia is temporarily unavailable.',
        suggestion: 'Try the request again later.',
      },
    ],
    [
      'INVALID_DELEGATION',
      502,
      {
        error: 'INVALID_DELEGATION',
        message: 'Sofia delegation could not be validated.',
      },
    ],
    [
      'INVALID_SOFIA_RESPONSE',
      502,
      {
        error: 'INVALID_SOFIA_RESPONSE',
        message: 'Sofia returned an invalid response.',
      },
    ],
    [
      'INVALID_COVI_RESPONSE',
      502,
      {
        error: 'INVALID_COVI_RESPONSE',
        message: 'Sofia returned an invalid response.',
      },
    ],
  ])('redacts upstream text for the supported %s API error', (code, status, expected) => {
    const payload = errorPayload(
      new CovalApiError(
        code,
        'FAKE_SENSITIVE_UPSTREAM_MESSAGE',
        [{ description: 'FAKE_SENSITIVE_UPSTREAM_DETAIL' }],
        status
      )
    );

    expect(payload).toEqual(expected);
    expect(JSON.stringify(payload)).not.toContain('FAKE_SENSITIVE');
  });

  it.each([
    [
      'ALREADY_EXISTS',
      409,
      {
        error: 'ALREADY_EXISTS',
        message: 'The requested resource already exists.',
        suggestion: 'Use a different identifier or update the existing resource.',
      },
    ],
    [
      'CONFLICT',
      409,
      {
        error: 'CONFLICT',
        message: 'The request conflicts with the current resource state.',
        suggestion: 'Refresh the resource and try again.',
      },
    ],
    [
      'FAILED_PRECONDITION',
      412,
      {
        error: 'FAILED_PRECONDITION',
        message: 'A required precondition was not met.',
        suggestion: 'Check the resource state and required setup before trying again.',
      },
    ],
    [
      'PAYLOAD_TOO_LARGE',
      413,
      {
        error: 'PAYLOAD_TOO_LARGE',
        message: 'The request payload is too large.',
        suggestion: 'Reduce the request size and try again.',
      },
    ],
    [
      'INTERNAL',
      500,
      {
        error: 'INTERNAL',
        message: 'The Coval API could not complete the request.',
        suggestion: 'Try the request again later.',
      },
    ],
    [
      'REQUEST_TIMEOUT',
      504,
      {
        error: 'REQUEST_TIMEOUT',
        message: 'The Coval API request timed out.',
        suggestion: 'Try the request again.',
      },
    ],
    [
      'INVALID_PROMPT',
      400,
      {
        error: 'INVALID_PROMPT',
        message: 'The Sofia request prompt was invalid.',
        suggestion: 'Revise the prompt and try again.',
      },
    ],
  ])('uses a static response for the %s API error', (code, status, expected) => {
    const payload = errorPayload(
      new CovalApiError(
        code,
        'FAKE_SENSITIVE_UPSTREAM_MESSAGE',
        [{ description: 'FAKE_SENSITIVE_UPSTREAM_DETAIL' }],
        status
      )
    );

    expect(payload).toEqual(expected);
    expect(JSON.stringify(payload)).not.toContain('FAKE_SENSITIVE');
  });

  it('replaces unknown API errors with a generic contract', () => {
    const payload = errorPayload(
      new CovalApiError(
        'FAKE_SENSITIVE_UPSTREAM_CODE',
        'FAKE_SENSITIVE_UPSTREAM_MESSAGE',
        [{ description: 'FAKE_SENSITIVE_UPSTREAM_DETAIL' }],
        500
      )
    );

    expect(payload).toEqual({
      error: 'API_ERROR',
      message: 'The Coval API request failed.',
    });
    expect(JSON.stringify(payload)).not.toContain('FAKE_SENSITIVE');
  });

  it('does not return unexpected error messages', () => {
    const payload = errorPayload(new Error('FAKE_SENSITIVE_RUNTIME_MESSAGE'));

    expect(payload).toEqual({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    });
    expect(JSON.stringify(payload)).not.toContain('FAKE_SENSITIVE');
  });
});
