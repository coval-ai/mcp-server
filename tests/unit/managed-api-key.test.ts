import { jest } from '@jest/globals';
import { ManagedApiKeyError, ManagedApiKeyProvider } from '../../src/managed-api-key.js';

describe('ManagedApiKeyProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('exchanges verified Clerk identity without forwarding an OAuth token', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () =>
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

  it('rechecks the backend on every request', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ api_key: 'managed-user-key', organization_id: 'org_123' }), {
        status: 200,
      }),
    );
    const provider = new ManagedApiKeyProvider('internal-service-key', 'https://api.example.com/v1');

    await provider.getApiKey('clerk_org_123', 'clerk_user_123');
    await provider.getApiKey('clerk_org_123', 'clerk_user_123');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps each exchange bound to its organization and user', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async (_url, init): Promise<Response> => {
        const body = JSON.parse(String(init?.body)) as {
          clerk_organization_id: string;
          user_id: string;
        };
        return new Response(
          JSON.stringify({
            api_key: `key:${body.clerk_organization_id}:${body.user_id}`,
            organization_id: body.clerk_organization_id,
          }),
          { status: 200 },
        );
      });
    const provider = new ManagedApiKeyProvider('internal-service-key', 'https://api.example.com/v1');

    await expect(provider.getApiKey('clerk_org_a', 'clerk_user_1')).resolves.toBe(
      'key:clerk_org_a:clerk_user_1',
    );
    await expect(provider.getApiKey('clerk_org_b', 'clerk_user_1')).resolves.toBe(
      'key:clerk_org_b:clerk_user_1',
    );
    await expect(provider.getApiKey('clerk_org_a', 'clerk_user_2')).resolves.toBe(
      'key:clerk_org_a:clerk_user_2',
    );
    await expect(provider.getApiKey('clerk_org_a', 'clerk_user_1')).resolves.toBe(
      'key:clerk_org_a:clerk_user_1',
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('does not share an authorization result between concurrent requests', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ api_key: 'managed-user-key', organization_id: 'org_123' }), {
        status: 200,
      }),
    );
    const provider = new ManagedApiKeyProvider('internal-service-key', 'https://api.example.com/v1');

    const first = provider.getApiKey('clerk_org_123', 'clerk_user_123');
    const second = provider.getApiKey('clerk_org_123', 'clerk_user_123');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(Promise.all([first, second])).resolves.toEqual([
      'managed-user-key',
      'managed-user-key',
    ]);
  });

  it('classifies an unavailable organization as a client-visible 404', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 404 }));
    const provider = new ManagedApiKeyProvider('internal-service-key', 'https://api.example.com/v1');

    await expect(provider.getApiKey('missing_org', 'clerk_user_123')).rejects.toEqual(
      expect.objectContaining<Partial<ManagedApiKeyError>>({
        message: 'The selected Coval organization or user is not available',
        status: 404,
      }),
    );
  });
});
