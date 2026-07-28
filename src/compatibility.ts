import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

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

function rewriteOpenAiMessage(message: unknown): unknown {
  if (typeof message !== 'object' || message === null) return message;

  const request = message as JsonRpcToolCall;
  if (
    request.method !== 'tools/call' ||
    typeof request.params !== 'object' ||
    request.params === null
  ) {
    return message;
  }

  const params = request.params as { name?: unknown; arguments?: unknown };
  if (!['consult_covi', 'consult_sofia'].includes(String(params.name))) {
    return message;
  }

  const legacyArguments =
    typeof params.arguments === 'object' && params.arguments !== null
      ? (params.arguments as Record<string, unknown>)
      : {};

  return {
    ...request,
    params: {
      ...(request.params as Record<string, unknown>),
      name: 'consult_sofia',
      arguments: {
        ...(typeof legacyArguments.prompt === 'string'
          ? { prompt: legacyArguments.prompt }
          : {}),
      },
    },
  };
}

/**
 * Keep cached pre-rename clients working without advertising a second tool in tools/list.
 */
export function rewriteLegacyToolCalls(payload: unknown): unknown {
  return Array.isArray(payload) ? payload.map(rewriteMessage) : rewriteMessage(payload);
}

/**
 * Keep cached OpenAI action snapshots working while enforcing the current prompt-only Sofia input.
 */
export function rewriteOpenAiToolCalls(payload: unknown): unknown {
  return Array.isArray(payload)
    ? payload.map(rewriteOpenAiMessage)
    : rewriteOpenAiMessage(payload);
}

/**
 * Apply the same hidden alias to transports, such as stdio, that do not expose an HTTP body.
 */
export class LegacyToolCallCompatibilityTransport implements Transport {
  onclose?: Transport['onclose'];
  onerror?: Transport['onerror'];
  onmessage?: Transport['onmessage'];

  constructor(private readonly delegate: Transport) {}

  get sessionId(): string | undefined {
    return this.delegate.sessionId;
  }

  async start(): Promise<void> {
    this.delegate.onclose = () => this.onclose?.();
    this.delegate.onerror = (error) => this.onerror?.(error);
    this.delegate.onmessage = (message, extra) => {
      this.onmessage?.(rewriteLegacyToolCalls(message) as typeof message, extra);
    };
    await this.delegate.start();
  }

  send: Transport['send'] = (message, options) => this.delegate.send(message, options);

  close(): Promise<void> {
    return this.delegate.close();
  }

  setProtocolVersion(version: string): void {
    this.delegate.setProtocolVersion?.(version);
  }
}
