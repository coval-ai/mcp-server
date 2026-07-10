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

export class ManagedApiKeyProvider {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly internalApiKey: string,
    private readonly apiBaseUrl = process.env.COVAL_API_BASE_URL || DEFAULT_API_BASE_URL,
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

    const response = await fetch(`${this.apiBaseUrl.replace(/\/$/, '')}/internal/mcp/api-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Coval-Internal-Api-Key': this.internalApiKey,
      },
      body: JSON.stringify({
        clerk_organization_id: clerkOrganizationId,
        user_id: clerkUserId,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await response.json().catch(() => ({}))) as Partial<ManagedKeyResponse> & {
      error?: string;
    };
    if (!response.ok || typeof payload.api_key !== 'string' || !payload.api_key) {
      throw new Error(
        response.status === 404
          ? 'The selected Coval organization or user is not available'
          : 'Unable to establish a Coval MCP session',
      );
    }

    this.cache.set(cacheKey, { apiKey: payload.api_key, expiresAt: Date.now() + CACHE_TTL_MS });
    while (this.cache.size > CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
    return payload.api_key;
  }
}
