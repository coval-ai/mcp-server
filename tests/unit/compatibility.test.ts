import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  LegacyToolCallCompatibilityTransport,
  rewriteLegacyToolCalls,
  rewriteOpenAiToolCalls,
} from '../../src/compatibility.js';

describe('legacy tool-call compatibility', () => {
  it('rewrites cached consult_covi calls to the canonical Sofia tool', () => {
    expect(
      rewriteLegacyToolCalls({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'consult_covi', arguments: { prompt: 'Inspect this run.' } },
      }),
    ).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'consult_sofia', arguments: { prompt: 'Inspect this run.' } },
    });
  });

  it('handles JSON-RPC batches without changing discovery or canonical calls', () => {
    const listRequest = { jsonrpc: '2.0', id: 1, method: 'tools/list' };
    const canonicalCall = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'consult_sofia', arguments: {} },
    };

    expect(rewriteLegacyToolCalls([listRequest, canonicalCall])).toEqual([
      listRequest,
      canonicalCall,
    ]);
  });

  it('minimizes cached Sofia calls only for the OpenAI profile', () => {
    const cachedCall = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'consult_sofia',
        arguments: {
          prompt: 'Inspect this run.',
          conversation: [{ role: 'user', content: 'prior turn' }],
          session_id: 'cached-session',
        },
      },
    };

    expect(rewriteOpenAiToolCalls(cachedCall)).toEqual({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'consult_sofia',
        arguments: { prompt: 'Inspect this run.' },
      },
    });
    expect(rewriteLegacyToolCalls(cachedCall)).toEqual(cachedCall);
  });

  it('renames and minimizes cached Covi calls for the OpenAI profile', () => {
    expect(
      rewriteOpenAiToolCalls({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'consult_covi',
          arguments: {
            prompt: 'Inspect this run.',
            session_id: 'cached-session',
          },
        },
      }),
    ).toEqual({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'consult_sofia',
        arguments: { prompt: 'Inspect this run.' },
      },
    });
  });

  it('rewrites legacy calls received over wrapped transports', async () => {
    const delegate: Transport = {
      start: async () => undefined,
      send: async () => undefined,
      close: async () => undefined,
    };
    const transport = new LegacyToolCallCompatibilityTransport(delegate);
    const received: JSONRPCMessage[] = [];
    transport.onmessage = (message) => received.push(message);

    await transport.start();
    delegate.onmessage?.({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'consult_covi', arguments: {} },
    });

    expect(received).toEqual([
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'consult_sofia', arguments: {} },
      },
    ]);
  });
});
