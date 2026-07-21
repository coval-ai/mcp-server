import type { AddressInfo } from 'node:net';
import { jest } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { allowedOrigins, createRemoteApp, organizationIdFromVerifiedToken } from '../../src/remote.js';

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

afterEach(() => {
  delete process.env.MCP_ALLOWED_ORIGINS;
  delete process.env.OPENAI_APPS_CHALLENGE;
});

describe('remote OAuth organization binding', () => {
  it('uses exact production browser origins and supports explicit overrides', () => {
    expect(allowedOrigins()).toEqual(
      new Set([
        'https://claude.ai',
        'https://claude.com',
        'https://chatgpt.com',
        'https://chat.openai.com',
        'https://platform.openai.com',
      ]),
    );
    expect(allowedOrigins('https://client.example.com/, https://other.example.com')).toEqual(
      new Set(['https://client.example.com', 'https://other.example.com']),
    );
    expect(() => allowedOrigins('https://client.example.com/path')).toThrow('Invalid origin');
    expect(() => allowedOrigins('ftp://client.example.com')).toThrow('Invalid origin');
  });

  it('extracts the selected organization from an already verified Clerk JWT', () => {
    const payload = Buffer.from(JSON.stringify({ org_id: 'org_clerk_123' })).toString('base64url');
    expect(organizationIdFromVerifiedToken(`header.${payload}.signature`)).toBe('org_clerk_123');
  });

  it('fails closed for opaque or organization-less tokens', () => {
    expect(organizationIdFromVerifiedToken('oat_opaque')).toBeUndefined();
    const payload = Buffer.from(JSON.stringify({ sub: 'user_123' })).toString('base64url');
    expect(organizationIdFromVerifiedToken(`header.${payload}.signature`)).toBeUndefined();
  });

  it('serves the configured OpenAI domain-verification token as plain text', async () => {
    process.env.OPENAI_APPS_CHALLENGE = 'openai-domain-proof';
    await withRemoteServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/.well-known/openai-apps-challenge`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/plain');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.text()).toBe('openai-domain-proof');
    });
  });

  it('does not expose a domain-verification endpoint until a token is configured', async () => {
    await withRemoteServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/.well-known/openai-apps-challenge`);

      expect(response.status).toBe(404);
    });
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

  it('terminates malformed Authorization headers without logging their values', async () => {
    const malformedAuthorization = 'Bearer';
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await withRemoteServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/mcp`, {
          method: 'POST',
          headers: {
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            Authorization: malformedAuthorization,
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
      expect(errorSpy).toHaveBeenCalledWith('Request failed before MCP handling');
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(malformedAuthorization);
    } finally {
      errorSpy.mockRestore();
    }
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
          Origin: 'https://claude.ai',
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
      expect(response.headers.get('access-control-allow-origin')).toBe('https://claude.ai');
      expect(response.headers.get('access-control-expose-headers')).toContain('WWW-Authenticate');
      expect(await response.text()).toContain('Coval MCP');
    });
  });

  it('rejects unknown browser origins before authentication or tool execution', async () => {
    await withRemoteServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          Origin: 'https://attacker.example.com',
          'X-API-Key': 'customer-api-key',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      });

      expect(response.status).toBe(403);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      expect(await response.json()).toEqual({ error: 'Request origin is not allowed' });
    });
  });

  it('rejects an unknown browser origin before parsing its request body', async () => {
    await withRemoteServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://attacker.example.com',
        },
        body: '{',
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'Request origin is not allowed' });
    });
  });

  it('allows non-browser MCP clients that omit Origin', async () => {
    await withRemoteServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
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
            clientInfo: { name: 'originless-client', version: '1' },
          },
        }),
      });

      expect(response.status).toBe(200);
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
