const DEFAULT_API_BASE_URL = 'https://api.coval.dev/v1';
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

interface ManagedKeyResponse {
  api_key: string;
  organization_id: string;
}

interface CacheEntry {
  apiKey: string;
  expiresAt: number;
}

export interface ManagedApiKeyCredentials {
  primary: string;
  fallback?: string;
}

export function managedApiKeyCredentialsFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): ManagedApiKeyCredentials {
  const dedicated = environment.COVAL_MCP_INTERNAL_API_KEY?.trim() || '';
  const previous = environment.COVAL_INTERNAL_API_KEY?.trim() || '';
  if (!dedicated) return { primary: previous };
  return {
    primary: dedicated,
    ...(previous && previous !== dedicated ? { fallback: previous } : {}),
  };
}

export class ManagedApiKeyError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ManagedApiKeyError';
  }
}

export class ManagedApiKeyProvider {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(
    private readonly internalApiKey: string,
    private readonly apiBaseUrl = process.env.COVAL_API_BASE_URL || DEFAULT_API_BASE_URL,
    private readonly fallbackInternalApiKey = '',
  ) {}

  isConfigured(): boolean {
    return Boolean(this.internalApiKey.trim());
  }

  async getApiKey(clerkOrganizationId: string, clerkUserId: string): Promise<string> {
    const cacheKey = `${clerkOrganizationId}:${clerkUserId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.cache.delete(cacheKey);
      this.cache.set(cacheKey, cached);
      return cached.apiKey;
    }
    this.cache.delete(cacheKey);

    const existingRequest = this.inFlight.get(cacheKey);
    if (existingRequest) return existingRequest;

    const request = this.fetchApiKey(cacheKey, clerkOrganizationId, clerkUserId).finally(() => {
      this.inFlight.delete(cacheKey);
    });
    this.inFlight.set(cacheKey, request);
    return request;
  }

  private async fetchApiKey(
    cacheKey: string,
    clerkOrganizationId: string,
    clerkUserId: string,
  ): Promise<string> {
    let response = await this.requestApiKey(
      clerkOrganizationId,
      clerkUserId,
      this.internalApiKey,
    );
    const fallbackInternalApiKey = this.fallbackInternalApiKey.trim();
    if (
      response.status === 401 &&
      fallbackInternalApiKey &&
      fallbackInternalApiKey !== this.internalApiKey.trim()
    ) {
      // The initial credential cutover spans independently deployed services. Retry the previous
      // credential once, and only for an explicit authentication rejection during that overlap.
      if (response.body) await response.body.cancel().catch(() => undefined);
      response = await this.requestApiKey(
        clerkOrganizationId,
        clerkUserId,
        fallbackInternalApiKey,
      );
    }

    const payload = (await response.json().catch(() => ({}))) as Partial<ManagedKeyResponse> & {
      error?: string;
    };
    if (!response.ok || typeof payload.api_key !== 'string' || !payload.api_key) {
      throw new ManagedApiKeyError(
        response.status === 404
          ? 'The selected Coval organization or user is not available'
          : 'Unable to establish a Coval MCP session',
        response.status === 404 ? 404 : 502,
      );
    }

    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, { apiKey: payload.api_key, expiresAt: Date.now() + CACHE_TTL_MS });
    while (this.cache.size > CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
    return payload.api_key;
  }

  private requestApiKey(
    clerkOrganizationId: string,
    clerkUserId: string,
    internalApiKey: string,
  ): Promise<Response> {
    return fetch(`${this.apiBaseUrl.replace(/\/$/, '')}/internal/mcp/api-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Coval-Internal-Api-Key': internalApiKey,
      },
      body: JSON.stringify({
        clerk_organization_id: clerkOrganizationId,
        user_id: clerkUserId,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  }
}
