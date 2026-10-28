import { jest } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createMcpServer } from '../../src/server.js';
import { CovalApiClient } from '../../src/client.js';
import { prepareTranscriptExport, type TranscriptApi } from '../../src/transcript-exports.js';

const originalBase = process.env.COVAL_API_BASE_URL;
const ids = Array.from({ length: 30 }, (_, i) => `call-${String(i).padStart(3, '0')}`);

function visible(result: CallToolResult): Record<string, unknown> {
  const block = result.content.find((item) => item.type === 'text');
  if (!block || block.type !== 'text') throw new Error('Missing JSON text');
  return JSON.parse(block.text) as Record<string, unknown>;
}

async function withClient(run: (client: Client) => Promise<void>, authenticated = true): Promise<void> {
  process.env.COVAL_API_BASE_URL = 'https://api.example.com/v1';
  const server = createMcpServer({ ...(authenticated ? { apiKey: 'synthetic-key' } : {}), inputProfile: 'openai' });
  const client = new Client({ name: 'transcript-export-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    await run(client);
  } finally {
    await client.close();
    await server.close();
  }
}

function apiFixture() {
  const state = { denied: false, changed: false, detailWrongRun: false, reversed: false };
  const raw = [
    { role: 'agent', content: '  preserve whitespace\n```literal```\n👍  ', start_offset: 0.125, end_offset: 1.25, future_field: { keep: [false, 0, '  '] } },
    { role: 'caller', content: '{"digits":"1"}', is_tool_call: true, tool_call_owner: 'caller', name: 'dtmf_tool', start_offset: 1.5, end_offset: 1.6 },
  ];
  const fetch = jest.spyOn(global, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    if (url.hostname === 'sofia.example.com') {
      expect(headers.get('Authorization')).toBe('Bearer delegation-only');
      expect(headers.get('x-api-key')).toBeNull();
      return new Response(JSON.stringify({ contract_version: '1', request_id: 'request-1', mode: 'read_only',
        summary: 'All thirty transcripts have been delivered.', evidence: [], proposed_actions: [],
        exports: [{ kind: 'run_transcripts', run_id: 'example-run', scope: 'default_workspace', state: 'requested' }],
      }), { status: 200 });
    }
    expect(headers.get('x-api-key')).toBe('synthetic-key');
    expect(headers.get('Authorization')).toBeNull();
    if (url.pathname.endsWith('/sofia/delegation-token')) {
      return new Response(JSON.stringify({ delegation_token: 'delegation-only', delegation_url: 'https://sofia.example.com/v1/external/delegations', expires_at: 1234, mode: 'read_only' }), { status: 200 });
    }
    if (state.denied) return new Response(JSON.stringify({ error: { code: 'PERMISSION_DENIED', message: 'Denied' } }), { status: 403 });
    if (url.pathname === '/v1/runs/example-run') return new Response(JSON.stringify({ run: { run_id: 'example-run' } }), { status: 200 });
    if (url.pathname === '/v1/conversations/simulated') {
      expect(url.searchParams.get('filter')).toBe('run_id="example-run"');
      const second = url.searchParams.get('page_token') === 'next';
      return new Response(JSON.stringify({ simulated_conversations: (state.reversed ? [...ids].reverse() : ids).slice(second ? 15 : 0, second ? 30 : 15).map((id) => ({ conversation_id: id, run_id: 'example-run' })), next_page_token: second ? null : 'next', total_size: 30 }), { status: 200 });
    }
    const id = url.pathname.split('/').at(-1)!;
    expect(ids).toContain(id);
    return new Response(JSON.stringify({ simulated_conversation: {
      conversation_id: id, run_id: state.detailWrongRun ? 'different-run' : 'example-run', status: 'COMPLETED',
      transcript: id === ids[28] ? null : id === ids[29]
        ? [{ role: 'agent', content: `${'Please preserve every word in this recorded conversation, including each timing marker and tool event.\n'.repeat(2500)}${state.changed ? 'CHANGED' : 'LAST_CALL_END'}`, start_time: 12.125, end_time: 13.5 }]
        : raw,
    } }), { status: 200 });
  });
  return { state, raw, fetch };
}

afterEach(() => {
  jest.restoreAllMocks();
  if (originalBase === undefined) delete process.env.COVAL_API_BASE_URL;
  else process.env.COVAL_API_BASE_URL = originalBase;
});

it('delivers all thirty calls through consult_sofia and an authenticated MCP resource', async () => {
  const fixture = apiFixture();
  await withClient(async (client) => {
    const output = await client.callTool({ name: 'consult_sofia', arguments: { prompt: 'Return every transcript for example-run.' } }) as CallToolResult;
    const payload = visible(output);
    const link = output.content.find((block) => block.type === 'resource_link');
    expect(link?.type).toBe('resource_link');
    if (!link || link.type !== 'resource_link') throw new Error('Missing resource attachment');
    expect((payload.exports as Array<{ call_count: number }>)[0].call_count).toBe(30);
    const read = await client.readResource({ uri: link.uri });
    const resource = read.contents[0];
    if (!('text' in resource)) throw new Error('Missing complete text');
    const document = JSON.parse(resource.text) as { calls: Array<{ call_id: string; transcript: unknown; status: string; reason: string | null }>; available_count: number; unavailable_count: number; end_marker: string };
    expect(document.calls.map((call) => call.call_id)).toEqual(ids);
    expect(document.available_count).toBe(29);
    expect(document.unavailable_count).toBe(1);
    expect(document.calls[0].transcript).toEqual(fixture.raw);
    expect(document.calls[28]).toMatchObject({ status: 'unavailable', reason: expect.any(String) });
    expect(resource.text).toContain('LAST_CALL_END');
    expect(resource.text.length).toBeGreaterThan(200_000);
    console.info('Synthetic transcript export proof', {
      utf8_bytes: Buffer.byteLength(resource.text), characters: resource.text.length,
      rough_tokens_at_four_chars: Math.ceil(resource.text.length / 4), normal_tool_character_cap: 12_000,
    });
    expect(document.end_marker).toBe('END_OF_COMPLETE_TRANSCRIPT_EXPORT');
    let complete = false;
    let offset = 0;
    let version: string | undefined;
    let text = '';
    while (!complete) {
      const page = visible(await client.callTool({ name: 'read_transcript_export', arguments: {
        uri: link.uri, offset, max_chars: 12_000, ...(version ? { expected_version: version } : {}),
      } }) as CallToolResult);
      text += page.text as string;
      complete = page.complete as boolean;
      offset = page.next_offset as number;
      version = page.version as string;
    }
    expect(text).toBe(resource.text);
  });
});

it('reports source changes and refuses fallback pages from different versions', async () => {
  const fixture = apiFixture();
  await withClient(async (client) => {
    const output = await client.callTool({ name: 'consult_sofia', arguments: { prompt: 'Export example-run.' } }) as CallToolResult;
    const artifact = (visible(output).exports as Array<{ uri: string }>)[0];
    const first = visible(await client.callTool({ name: 'read_transcript_export', arguments: { uri: artifact.uri, max_chars: 4000 } }) as CallToolResult);
    fixture.state.changed = true;
    const continuation = await client.callTool({ name: 'read_transcript_export', arguments: { uri: artifact.uri, offset: first.next_offset, expected_version: first.version } }) as CallToolResult;
    expect(continuation.isError).toBe(true);
    expect(visible(continuation)).not.toHaveProperty('text');
    const read = await client.readResource({ uri: artifact.uri });
    const resource = read.contents[0];
    if (!('text' in resource)) throw new Error('Missing text');
    expect(JSON.parse(resource.text)).toMatchObject({ status: 'source_changed', changed_call_ids: [ids[29]] });
  });
});

it('reauthorizes resource reads and lets collection failure override readiness prose', async () => {
  const fixture = apiFixture();
  await withClient(async (client) => {
    fixture.state.detailWrongRun = true;
    const failed = visible(await client.callTool({ name: 'consult_sofia', arguments: { prompt: 'Export example-run.' } }) as CallToolResult);
    expect(failed.summary).not.toContain('have been delivered');
    expect(failed).not.toHaveProperty('exports');
    expect(failed.export_errors).toEqual([expect.objectContaining({ status: 'failed' })]);
    fixture.state.detailWrongRun = false;
    const ready = visible(await client.callTool({ name: 'consult_sofia', arguments: { prompt: 'Export example-run.' } }) as CallToolResult);
    const uri = (ready.exports as Array<{ uri: string }>)[0].uri;
    fixture.state.denied = true;
    await expect(client.readResource({ uri })).rejects.toThrow();
  });
});

it('refuses oversized runs rather than returning a sample', async () => {
  const api: TranscriptApi = {
    getRun: async () => ({ run: { run_id: 'example-run' } }),
    list: async () => ({ simulated_conversations: Array.from({ length: 101 }, (_, i) => ({ conversation_id: `call-${i}`, run_id: 'example-run' })) }),
    get: async () => { throw new Error('No detail reads should be attempted'); },
  };
  await expect(prepareTranscriptExport(api, 'example-run')).rejects.toThrow('at most 100');
});

it('uses fresh authenticated server state and refuses anonymous resource reads', async () => {
  const fixture = apiFixture();
  let uri = '';
  await withClient(async (client) => {
    const output = visible(await client.callTool({ name: 'consult_sofia', arguments: { prompt: 'Export example-run.' } }) as CallToolResult);
    uri = (output.exports as Array<{ uri: string }>)[0].uri;
  });
  await withClient(async (client) => {
    const resource = await client.readResource({ uri });
    expect(resource.contents).toHaveLength(1);
  });
  const before = fixture.fetch.mock.calls.length;
  await withClient(async (client) => {
    await expect(client.readResource({ uri })).rejects.toThrow();
  }, false);
  expect(fixture.fetch.mock.calls).toHaveLength(before);
});

it('reports inventory order changes even when every transcript is unchanged', async () => {
  const fixture = apiFixture();
  await withClient(async (client) => {
    const output = await client.callTool({ name: 'consult_sofia', arguments: { prompt: 'Export example-run.' } }) as CallToolResult;
    const artifact = (visible(output).exports as Array<{ uri: string }>)[0];
    fixture.state.reversed = true;
    const resource = (await client.readResource({ uri: artifact.uri })).contents[0];
    if (!('text' in resource)) throw new Error('Missing text');
    expect(JSON.parse(resource.text)).toMatchObject({ status: 'source_changed', source_order_changed: true, changed_call_ids: [], removed_call_ids: [] });
  });
});

it('keeps UTF-8 fragments lossless when max_chars=1 crosses an emoji', async () => {
  const text = 'A👍éZ';
  jest.spyOn(CovalApiClient.prototype, 'readRunTranscriptExport').mockResolvedValue({ text, version: 'a'.repeat(43) });
  await withClient(async (client) => {
    const pages: Buffer[] = [];
    for (let offset = 0; offset < 4; offset += 1) {
      const page = visible(await client.callTool({ name: 'read_transcript_export', arguments: {
        uri: 'coval://run-transcripts/example/manifest', offset, max_chars: 1,
        ...(offset ? { expected_version: 'a'.repeat(43) } : {}),
      } }) as CallToolResult);
      expect(page.offset_unit).toBe('unicode_code_points');
      expect(page.next_offset).toBe(offset < 3 ? offset + 1 : null);
      expect(page.complete).toBe(offset === 3);
      pages.push(Buffer.from(page.text as string, 'utf8'));
    }
    expect(pages[1]).toEqual(Buffer.from('👍', 'utf8'));
    expect(Buffer.concat(pages)).toEqual(Buffer.from(text, 'utf8'));
  });
});
