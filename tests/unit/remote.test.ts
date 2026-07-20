import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createRemoteApp, organizationIdFromVerifiedToken } from '../../src/remote.js';

async function withRemoteServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_Y2xlcmsudGVzdCQ=';
  process.env.CLERK_SECRET_KEY = 'sk_test_not-a-real-key';
  process.env.CLERK_TELEMETRY_DISABLED = 'true';
  const app = await createRemoteApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe('remote OAuth organization binding', () => {
  it('extracts the selected organization from an already verified Clerk JWT', () => {
    const payload = Buffer.from(JSON.stringify({ org_id: 'org_clerk_123' })).toString('base64url');
    expect(organizationIdFromVerifiedToken(`header.${payload}.signature`)).toBe('org_clerk_123');
  });

  it('fails closed for opaque or organization-less tokens', () => {
    expect(organizationIdFromVerifiedToken('oat_opaque')).toBeUndefined();
    const payload = Buffer.from(JSON.stringify({ sub: 'user_123' })).toString('base64url');
    expect(organizationIdFromVerifiedToken(`header.${payload}.signature`)).toBeUndefined();
  });

  it('challenges unauthenticated requests with protected resource metadata', async () => {
    await withRemoteServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      });

      expect(response.status).toBe(401);
      const challenge = response.headers.get('www-authenticate');
      expect(challenge).toContain('Bearer resource_metadata=');
      expect(challenge).toContain('/.well-known/oauth-protected-resource/mcp');
    });
  });

  it('terminates malformed Authorization headers with a 4xx instead of hanging', async () => {
    await withRemoteServer(async (baseUrl) => {
      // "Bearer" with no token makes @clerk/mcp-tools' mcpAuth throw rather than respond; the
      // rejection must be caught and answered or the client hangs with no response at all.
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          Authorization: 'Bearer',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
        signal: AbortSignal.timeout(3000),
      });

      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toContain('Bearer resource_metadata=');
      expect(await response.json()).toEqual({
        error: 'Invalid Authorization header, expected Bearer <token>',
      });
    });
  });

  it('rejects POST requests that do not accept text/event-stream', async () => {
    await withRemoteServer(async (baseUrl) => {
      // Regression guard for the documented breaking change: legacy clients sending only
      // `Accept: application/json` are refused by the Streamable HTTP transport.
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-API-Key': 'customer-api-key',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'test', version: '1' },
          },
        }),
      });

      expect(response.status).toBe(406);
      const body = (await response.json()) as { error?: { code?: number } };
      expect(body.error?.code).toBe(-32000);
    });
  });

  it('serves the SDK Streamable HTTP transport for API-key migration clients', async () => {
    await withRemoteServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          Origin: 'https://client.example.com',
          'X-API-Key': 'customer-api-key',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'test', version: '1' },
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe('*');
      expect(response.headers.get('access-control-expose-headers')).toContain('WWW-Authenticate');
      expect(await response.text()).toContain('Coval MCP');
    });
  });

  it('supports a stateless SDK client across initialize and tools/list requests', async () => {
    await withRemoteServer(async (baseUrl) => {
      const transport = new StreamableHTTPClientTransport(
        new URL(`${baseUrl}/mcp`),
        { requestInit: { headers: { 'X-API-Key': 'customer-api-key' } } },
      );
      const client = new Client({ name: 'stateless-test-client', version: '1' });

      try {
        await client.connect(transport);
        const tools = await client.listTools();
        expect(tools.tools.map((tool) => tool.name)).toContain('consult_covi');
        for (const tool of tools.tools) {
          expect(tool.title).toBeTruthy();
          expect(typeof tool.annotations?.readOnlyHint).toBe('boolean');
          expect(typeof tool.annotations?.destructiveHint).toBe('boolean');
        }
      } finally {
        await client.close();
      }
    });
  });
});
