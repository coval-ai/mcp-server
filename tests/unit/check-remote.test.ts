import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = fileURLToPath(new URL('../../scripts/check-remote.mjs', import.meta.url));

async function checkRemote(metadata: Record<string, unknown>) {
  let origin = '';
  const server = createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ status: 'healthy' }));
    } else if (request.url === '/.well-known/oauth-protected-resource/mcp') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ resource: `${origin}/mcp`, authorization_servers: [origin] }));
    } else if (request.url === '/.well-known/oauth-authorization-server') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(metadata));
    } else if (request.url === '/mcp' && request.method === 'POST') {
      if (request.headers.origin === 'https://attacker.example.com') {
        response.writeHead(403);
      } else {
        response.writeHead(401, {
          'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
          ...(request.headers.origin === 'https://claude.ai'
            ? { 'Access-Control-Allow-Origin': 'https://claude.ai' }
            : {}),
        });
      }
      response.end();
    } else {
      response.writeHead(404);
      response.end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    return await execFileAsync(process.execPath, [script], {
      env: { ...process.env, COVAL_MCP_URL: `${origin}/mcp` },
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

const baseMetadata = {
  authorization_endpoint: 'https://auth.example.com/authorize',
  token_endpoint: 'https://auth.example.com/token',
  code_challenge_methods_supported: ['S256'],
};

describe('remote OAuth discovery preflight', () => {
  it('accepts CIMD with public token authentication and no DCR endpoint', async () => {
    const result = await checkRemote({
      ...baseMetadata,
      client_id_metadata_document_supported: true,
      token_endpoint_auth_methods_supported: ['none'],
    });
    expect(result.stdout).toContain('Coval remote MCP preflight passed');
  });

  it('continues to accept DCR-only discovery', async () => {
    const result = await checkRemote({
      ...baseMetadata,
      registration_endpoint: 'https://auth.example.com/register',
    });
    expect(result.stdout).toContain('Coval remote MCP preflight passed');
  });

  it.each([
    ['no client onboarding', {}],
    ['CIMD without public token authentication', {
      client_id_metadata_document_supported: true,
      token_endpoint_auth_methods_supported: ['client_secret_basic'],
    }],
    ['malformed token authentication methods', {
      client_id_metadata_document_supported: true,
      token_endpoint_auth_methods_supported: 'none',
    }],
    ['a non-boolean CIMD advertisement', {
      client_id_metadata_document_supported: 'true',
      token_endpoint_auth_methods_supported: ['none'],
    }],
  ])('rejects %s', async (_description, overrides) => {
    await expect(checkRemote({ ...baseMetadata, ...overrides })).rejects.toThrow(
      'OAuth metadata advertises neither DCR nor public CIMD support',
    );
  });

  it('still requires PKCE S256 for CIMD', async () => {
    await expect(checkRemote({
      ...baseMetadata,
      code_challenge_methods_supported: [],
      client_id_metadata_document_supported: true,
      token_endpoint_auth_methods_supported: ['none'],
    })).rejects.toThrow('OAuth metadata does not advertise PKCE S256');
  });
});
