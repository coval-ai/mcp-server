import { requestCompletion, runtimeIdentity } from '../../src/observability.js';

describe('hosted MCP observability', () => {
  it('uses the immutable source SHA as the release identity', () => {
    expect(runtimeIdentity({
      DD_ENV: 'v1',
      DD_SERVICE: 'coval-mcp-server',
      DD_VERSION: 'a'.repeat(40),
    })).toEqual({
      service: 'coval-mcp-server',
      env: 'v1',
      version: 'a'.repeat(40),
    });
  });

  it('emits only low-cardinality request completion fields', () => {
    const entry = requestCompletion(
      { method: 'post', originalUrl: '/mcp?token=must-not-appear' },
      401,
      12.6,
      { DD_ENV: 'v1', DD_SERVICE: 'coval-mcp-server', DD_VERSION: 'release-sha' },
    );

    expect(entry).toEqual({
      event: 'mcp.request.completed',
      message: 'mcp_request_completed',
      service: 'coval-mcp-server',
      env: 'v1',
      version: 'release-sha',
      surface: 'mcp',
      http_method: 'POST',
      http_path: '/mcp',
      http_status: 401,
      status: 'auth_error',
      duration_ms: 13,
    });
    expect(JSON.stringify(entry)).not.toContain('must-not-appear');
  });

  it('collapses unknown paths instead of logging arbitrary URLs', () => {
    expect(requestCompletion(
      { method: 'GET', originalUrl: '/customer/supplied/path' },
      500,
      -1,
    )).toMatchObject({ http_path: 'other', status: 'error', duration_ms: 0 });
  });
});
