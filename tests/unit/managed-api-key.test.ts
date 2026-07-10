import { jest } from '@jest/globals';
import { ManagedApiKeyProvider } from '../../src/managed-api-key.js';

describe('ManagedApiKeyProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('exchanges verified Clerk identity without forwarding an OAuth token', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ api_key: 'managed-user-key', organization_id: 'org_123' }), {
        status: 200,
      }),
    );
    const provider = new ManagedApiKeyProvider('internal-service-key', 'https://api.example.com/v1');

    await expect(provider.getApiKey('clerk_org_123', 'clerk_user_123')).resolves.toBe(
      'managed-user-key',
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/internal/mcp/api-key',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Coval-Internal-Api-Key': 'internal-service-key',
        }),
        body: JSON.stringify({
          clerk_organization_id: 'clerk_org_123',
          user_id: 'clerk_user_123',
        }),
      }),
    );
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('oauth');
  });

  it('reuses a bounded short-lived managed key cache', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ api_key: 'managed-user-key', organization_id: 'org_123' }), {
        status: 200,
      }),
    );
    const provider = new ManagedApiKeyProvider('internal-service-key', 'https://api.example.com/v1');

    await provider.getApiKey('clerk_org_123', 'clerk_user_123');
    await provider.getApiKey('clerk_org_123', 'clerk_user_123');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
