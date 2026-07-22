import { rewriteLegacyToolCalls } from '../../src/compatibility.js';

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
});
