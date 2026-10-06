import { describe, expect, it, jest } from '@jest/globals';
import { createRequire } from 'node:module';
import { fetchToken, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';

const require = createRequire(import.meta.url);
const proxyaddr = require('proxy-addr') as {
  (request: { socket: { remoteAddress: string }; headers: Record<string, string> }, trust: string): string;
  compile(subnet: string): (address: string) => boolean;
};

describe('production dependency trust boundaries', () => {
  it.each(['::ffff:10.0.0.0/8', '::/1'])('does not trust arbitrary IPv4 clients through %s', (subnet) => {
    expect(proxyaddr.compile(subnet)('203.0.113.10')).toBe(false);
    expect(proxyaddr({
      socket: { remoteAddress: '203.0.113.10' },
      headers: { 'x-forwarded-for': '10.0.0.20' },
    }, subnet)).toBe('203.0.113.10');
  });

  it.each(['10.0.0.0/8', '::ffff:10.0.0.0/104'])('preserves valid IPv4 proxy trust through %s', (subnet) => {
    const trust = proxyaddr.compile(subnet);
    expect(trust('10.0.0.10')).toBe(true);
    expect(trust('203.0.113.10')).toBe(false);
    expect(proxyaddr({
      socket: { remoteAddress: '10.0.0.10' },
      headers: { 'x-forwarded-for': '203.0.113.20' },
    }, subnet)).toBe('203.0.113.20');
  });

  const issuer = 'https://authorization.example.test/';
  function provider(): OAuthClientProvider {
    return {
      redirectUrl: 'http://localhost/callback',
      clientMetadata: { redirect_uris: ['http://localhost/callback'] },
      clientInformation: () => ({ client_id: 'test-client', client_secret: 'synthetic-secret', issuer }),
      tokens: () => undefined,
      saveTokens: async () => {},
      redirectToAuthorization: async () => {},
      saveCodeVerifier: async () => {},
      codeVerifier: () => 'synthetic-verifier',
      prepareTokenRequest: () => new URLSearchParams({ grant_type: 'client_credentials' }),
    };
  }

  it('rejects credentials bound to a different OAuth issuer before sending a token request', async () => {
    const send = jest.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'synthetic-token', token_type: 'Bearer',
    }), { status: 200 }));
    await expect(fetchToken(provider(), new URL('https://untrusted.example.test/'), { fetchFn: send }))
      .rejects.toThrow('bound to authorization server');
    expect(send).not.toHaveBeenCalled();
  });

  it('preserves token requests to the issuer that owns the credentials', async () => {
    const send = jest.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'synthetic-token', token_type: 'Bearer',
    }), { status: 200 }));
    await expect(fetchToken(provider(), new URL(issuer), { fetchFn: send })).resolves.toMatchObject({
      access_token: 'synthetic-token',
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(String(send.mock.calls[0][0])).toBe(`${issuer}token`);
  });
});
