import { jest } from '@jest/globals';
import {
  ManagedApiKeyError,
  managedApiKeyCredentialsFromEnvironment,
  ManagedApiKeyProvider,
} from '../../src/managed-api-key.js';

describe('ManagedApiKeyProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('prefers the dedicated credential and retains the previous credential for rollout overlap', () => {
    expect(
      managedApiKeyCredentialsFromEnvironment({
        COVAL_MCP_INTERNAL_API_KEY: ' dedicated-service-key ',
        COVAL_INTERNAL_API_KEY: ' previous-service-key ',
      }),
    ).toEqual({
      primary: 'dedicated-service-key',
      fallback: 'previous-service-key',
    });
  });

  it('uses the previous credential directly when no dedicated credential is configured', () => {
    expect(
      managedApiKeyCredentialsFromEnvironment({
        COVAL_INTERNAL_API_KEY: 'previous-service-key',
      }),
    ).toEqual({
      primary: 'previous-service-key',
    });
  });

  it('does not configure a fallback when both environment variables contain the same credential', () => {
    expect(
      managedApiKeyCredentialsFromEnvironment({
        COVAL_MCP_INTERNAL_API_KEY: 'same-service-key',
        COVAL_INTERNAL_API_KEY: 'same-service-key',
      }),
    ).toEqual({
      primary: 'same-service-key',
    });
  });

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

  it('retries the previous credential once after an authentication rejection', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ api_key: 'managed-user-key', organization_id: 'org_123' }), {
          status: 200,
        }),
      );
    const provider = new ManagedApiKeyProvider(
      'dedicated-service-key',
      'https://api.example.com/v1',
      'previous-service-key',
    );

    await expect(provider.getApiKey('clerk_org_123', 'clerk_user_123')).resolves.toBe(
      'managed-user-key',
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual(
      expect.objectContaining({ 'X-Coval-Internal-Api-Key': 'dedicated-service-key' }),
    );
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual(
      expect.objectContaining({ 'X-Coval-Internal-Api-Key': 'previous-service-key' }),
    );
  });

  it('does not use the rollout fallback for non-authentication failures', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 503 }));
    const provider = new ManagedApiKeyProvider(
      'dedicated-service-key',
      'https://api.example.com/v1',
      'previous-service-key',
    );

    await expect(provider.getApiKey('clerk_org_123', 'clerk_user_123')).rejects.toEqual(
      expect.objectContaining<Partial<ManagedApiKeyError>>({
        message: 'Unable to establish a Coval MCP session',
        status: 502,
      }),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it('isolates cached managed keys across different organization and user identities', async () => {
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
    // Cached lookups stay bound to their own (organization, user) pair.
    await expect(provider.getApiKey('clerk_org_a', 'clerk_user_1')).resolves.toBe(
      'key:clerk_org_a:clerk_user_1',
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('coalesces concurrent identity exchanges for the same user and organization', async () => {
    let resolveFetch!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = jest.spyOn(global, 'fetch').mockReturnValue(response);
    const provider = new ManagedApiKeyProvider('internal-service-key', 'https://api.example.com/v1');

    const first = provider.getApiKey('clerk_org_123', 'clerk_user_123');
    const second = provider.getApiKey('clerk_org_123', 'clerk_user_123');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(
      new Response(JSON.stringify({ api_key: 'managed-user-key', organization_id: 'org_123' }), {
        status: 200,
      }),
    );
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
