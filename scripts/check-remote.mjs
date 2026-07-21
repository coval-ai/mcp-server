const endpoint = new URL(process.env.COVAL_MCP_URL ?? 'https://mcp.coval.dev/mcp');
const origin = endpoint.origin;

async function expectJson(url, validate) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}`);
  }
  const body = await response.json();
  validate(body);
}

await expectJson(`${origin}/health`, (body) => {
  if (body.status !== 'healthy') throw new Error('Health endpoint is not healthy');
});

let authorizationServer;
await expectJson(`${origin}/.well-known/oauth-protected-resource/mcp`, (body) => {
  if (body.resource !== endpoint.href) {
    throw new Error('Protected resource URL does not match the MCP endpoint');
  }
  if (!Array.isArray(body.authorization_servers) || body.authorization_servers.length !== 1) {
    throw new Error('Expected exactly one OAuth authorization server');
  }
  authorizationServer = body.authorization_servers[0];
});

await expectJson(`${authorizationServer}/.well-known/oauth-authorization-server`, (body) => {
  for (const field of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
    if (!body[field]) throw new Error(`OAuth metadata is missing ${field}`);
  }
  if (!body.code_challenge_methods_supported?.includes('S256')) {
    throw new Error('OAuth metadata does not advertise PKCE S256');
  }
});

const challenge = await fetch(endpoint, {
  method: 'POST',
  headers: {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'coval-remote-check', version: '1.0.0' },
    },
  }),
  signal: AbortSignal.timeout(10_000),
});

if (challenge.status !== 401) {
  throw new Error(`Unauthenticated initialize returned ${challenge.status}, expected 401`);
}
const authenticate = challenge.headers.get('www-authenticate');
if (!authenticate?.includes('/.well-known/oauth-protected-resource/mcp')) {
  throw new Error('MCP challenge does not point to protected-resource metadata');
}

const acceptedOrigin = await fetch(endpoint, {
  method: 'POST',
  headers: {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    Origin: 'https://claude.ai',
  },
  body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }),
  signal: AbortSignal.timeout(10_000),
});
if (acceptedOrigin.status !== 401) {
  throw new Error(`Trusted-origin initialize returned ${acceptedOrigin.status}, expected 401`);
}
if (acceptedOrigin.headers.get('access-control-allow-origin') !== 'https://claude.ai') {
  throw new Error('Trusted browser origin was not reflected by CORS');
}

const rejectedOrigin = await fetch(endpoint, {
  method: 'POST',
  headers: {
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    Origin: 'https://attacker.example.com',
  },
  body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping' }),
  signal: AbortSignal.timeout(10_000),
});
if (rejectedOrigin.status !== 403) {
  throw new Error(`Untrusted-origin initialize returned ${rejectedOrigin.status}, expected 403`);
}

console.log(`Coval remote MCP preflight passed for ${endpoint.href}`);
