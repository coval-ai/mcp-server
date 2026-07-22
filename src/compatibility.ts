type JsonRpcToolCall = {
  method?: unknown;
  params?: unknown;
  [key: string]: unknown;
};

function rewriteMessage(message: unknown): unknown {
  if (typeof message !== 'object' || message === null) return message;

  const request = message as JsonRpcToolCall;
  if (
    request.method !== 'tools/call' ||
    typeof request.params !== 'object' ||
    request.params === null ||
    (request.params as { name?: unknown }).name !== 'consult_covi'
  ) {
    return message;
  }

  return {
    ...request,
    params: {
      ...(request.params as Record<string, unknown>),
      name: 'consult_sofia',
    },
  };
}

/**
 * Keep cached pre-rename clients working without advertising a second tool in tools/list.
 */
export function rewriteLegacyToolCalls(payload: unknown): unknown {
  return Array.isArray(payload) ? payload.map(rewriteMessage) : rewriteMessage(payload);
}
