const DEFAULT_BASE_URL = 'https://api.coval.dev/v1';
const SOFIA_DELEGATION_TIMEOUT_MS = 120_000;
const SOFIA_TOKEN_EXCHANGE_TIMEOUT_MS = 15_000;

export interface PaginationParams {
  page_size?: number;
  page_token?: string;
  order_by?: string;
  filter?: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Array<{ field?: string; description: string }>;
}

export interface SofiaConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SofiaConsultation {
  contractVersion: string;
  requestId: string;
  mode: 'read_only';
  summary: string;
  evidence: Array<{ name: string; status: string }>;
  proposedActions: never[];
}

interface SofiaConsultationResponse {
  contract_version: string;
  request_id: string;
  mode: 'read_only';
  summary: string;
  evidence: Array<{ name: string; status: string }>;
  proposed_actions: never[];
}

interface SofiaDelegationTokenResponse {
  delegation_token: string;
  delegation_url: string;
  expires_at: number;
  mode: 'read_only';
}

export class CovalApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: Array<{ field?: string; description: string }>,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'CovalApiError';
  }
}

export class CovalApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || process.env.COVAL_API_BASE_URL || DEFAULT_BASE_URL;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string | number | boolean | undefined>,
    signal?: AbortSignal,
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);

    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      });
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });

    const data = await response.json();

    if (!response.ok) {
      const error = data.error as ApiError;
      throw new CovalApiError(
        error?.code || 'UNKNOWN_ERROR',
        error?.message || 'Request failed',
        error?.details,
        response.status
      );
    }

    return data as T;
  }

  // Runs
  async listRuns(params?: PaginationParams) {
    return this.request<{ runs: unknown[]; next_page_token?: string }>(
      'GET',
      '/runs',
      undefined,
      params as Record<string, string | number | boolean | undefined>
    );
  }

  async getRun(runId: string) {
    return this.request<{ run: unknown }>('GET', `/runs/${runId}`);
  }

  async createRun(data: {
    agent_id: string;
    persona_id: string;
    test_set_id: string;
    metric_ids?: string[];
    tags?: string[];
    options?: { iteration_count?: number; concurrency?: number };
    metadata?: Record<string, unknown>;
  }) {
    return this.request<{ run: unknown }>('POST', '/runs', data);
  }

  async deleteRun(runId: string) {
    return this.request<Record<string, never>>('DELETE', `/runs/${runId}`);
  }

  // Agents
  async listAgents(params?: PaginationParams) {
    return this.request<{ agents: unknown[]; next_page_token?: string }>(
      'GET',
      '/agents',
      undefined,
      params as Record<string, string | number | boolean | undefined>
    );
  }

  async getAgent(agentId: string) {
    return this.request<{ agent: unknown }>('GET', `/agents/${agentId}`);
  }

  async createAgent(data: {
    display_name: string;
    model_type: string;
    phone_number?: string;
    endpoint?: string;
    prompt?: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.request<{ agent: unknown }>('POST', '/agents', data);
  }

  async updateAgent(
    agentId: string,
    data: {
      display_name?: string;
      phone_number?: string;
      endpoint?: string;
      prompt?: string;
      metadata?: Record<string, unknown>;
    }
  ) {
    return this.request<{ agent: unknown }>('PATCH', `/agents/${agentId}`, data);
  }

  // Test Sets
  async listTestSets(params?: PaginationParams) {
    return this.request<{ test_sets: unknown[]; next_page_token?: string }>(
      'GET',
      '/test-sets',
      undefined,
      params as Record<string, string | number | boolean | undefined>
    );
  }

  async getTestSet(testSetId: string) {
    return this.request<{ test_set: unknown }>('GET', `/test-sets/${testSetId}`);
  }

  async createTestSet(data: {
    display_name: string;
    slug?: string;
    description?: string;
    test_set_type?: string;
    test_set_metadata?: Record<string, unknown>;
    parameters?: Record<string, unknown>;
  }) {
    return this.request<{ test_set: unknown }>('POST', '/test-sets', data);
  }

  // Metrics
  async listMetrics(params?: PaginationParams & { include_builtin?: boolean }) {
    return this.request<{ metrics: unknown[]; next_page_token?: string }>(
      'GET',
      '/metrics',
      undefined,
      params as Record<string, string | number | boolean | undefined>
    );
  }

  async getMetric(metricId: string) {
    return this.request<{ metric: unknown }>('GET', `/metrics/${metricId}`);
  }

  // Personas
  async listPersonas(params?: PaginationParams) {
    return this.request<{ personas: unknown[]; next_page_token?: string }>(
      'GET',
      '/personas',
      undefined,
      params as Record<string, string | number | boolean | undefined>
    );
  }

  async getPersona(personaId: string) {
    return this.request<{ persona: unknown }>('GET', `/personas/${personaId}`);
  }

  // Test Cases
  async listTestCases(params?: PaginationParams) {
    return this.request<{ test_cases: unknown[]; next_page_token?: string }>(
      'GET',
      '/test-cases',
      undefined,
      params as Record<string, string | number | boolean | undefined>
    );
  }

  async getTestCase(testCaseId: string) {
    return this.request<{ test_case: unknown }>('GET', `/test-cases/${testCaseId}`);
  }

  async createTestCase(data: {
    test_set_id: string;
    input_str: string;
    expected_behaviors?: string[];
    description?: string;
    simulation_metadata_input?: Record<string, unknown>;
    metric_input?: Record<string, unknown>;
    user_notes?: string;
  }) {
    return this.request<{ test_case: unknown }>('POST', '/test-cases', data);
  }

  async updateTestCase(
    testCaseId: string,
    data: {
      input_str?: string;
      expected_behaviors?: string[];
      description?: string;
      simulation_metadata_input?: Record<string, unknown>;
      metric_input?: Record<string, unknown>;
      user_notes?: string;
    }
  ) {
    return this.request<{ test_case: unknown }>('PATCH', `/test-cases/${testCaseId}`, data);
  }

  /**
   * Ask the server-side Sofia runtime for a read-only, organization-grounded consultation.
   *
   * The customer API key authenticates only the short token exchange. The key is never sent to
   * Sofia; the returned token is audience-, org-, subject-, and time-bound and is used only for
   * this read-only consultation request.
   */
  async consultSofia(input: {
    prompt: string;
    conversation?: SofiaConversationMessage[];
    sessionId?: string;
  }): Promise<SofiaConsultation> {
    let tokenResponse: SofiaDelegationTokenResponse;
    try {
      tokenResponse = await this.request<SofiaDelegationTokenResponse>(
        'POST',
        // Keep using the legacy backend route until every deployed minter supports the Sofia alias.
        '/covi/delegation-token',
        {
          client_id: 'coval-mcp',
          ...(input.sessionId ? { session_id: input.sessionId } : {}),
        },
        undefined,
        AbortSignal.timeout(SOFIA_TOKEN_EXCHANGE_TIMEOUT_MS),
      );
    } catch (error) {
      if (error instanceof CovalApiError) throw error;
      throw new CovalApiError('COVI_UNAVAILABLE', 'Sofia delegation was unavailable');
    }
    if (tokenResponse.mode !== 'read_only' || !tokenResponse.delegation_token || !tokenResponse.delegation_url) {
      throw new CovalApiError('INVALID_DELEGATION', 'Sofia delegation response was invalid');
    }

    const delegationUrl = validateSofiaDelegationUrl(tokenResponse.delegation_url, this.baseUrl);
    let response: Response;
    try {
      response = await fetch(delegationUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenResponse.delegation_token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          prompt: input.prompt,
          conversation: input.conversation || []
        }),
        signal: AbortSignal.timeout(SOFIA_DELEGATION_TIMEOUT_MS)
      });
    } catch {
      throw new CovalApiError('COVI_UNAVAILABLE', 'Sofia consultation timed out or was unavailable');
    }
    const payload: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = (payload as { error?: ApiError }).error;
      throw new CovalApiError(
        error?.code || 'COVI_UNAVAILABLE',
        error?.message || 'Sofia consultation failed',
        error?.details,
        response.status
      );
    }
    const consultation = parseSofiaConsultation(payload);
    return {
      contractVersion: consultation.contract_version,
      requestId: consultation.request_id,
      mode: consultation.mode,
      summary: consultation.summary,
      evidence: consultation.evidence,
      proposedActions: consultation.proposed_actions
    };
  }
}

function validateSofiaDelegationUrl(delegationUrl: string, apiBaseUrl: string): string {
  let endpoint: URL;
  let apiUrl: URL;
  try {
    endpoint = new URL(delegationUrl);
    apiUrl = new URL(apiBaseUrl);
  } catch {
    throw new CovalApiError('INVALID_DELEGATION', 'Sofia delegation response was invalid');
  }
  const environmentSuffix = apiUrl.pathname.includes('staging') ? '-staging' : '';
  const expectedHost = apiUrl.hostname.replace(/^api(?=[.-])/, `sofia${environmentSuffix}`);
  const configuredOrigin = (
    process.env.SOFIA_DELEGATION_ORIGIN || process.env.COVI_DELEGATION_ORIGIN
  )?.replace(/\/$/, '');
  const expectedOrigin = configuredOrigin || `https://${expectedHost}`;
  let expectedOriginUrl: URL;
  try {
    expectedOriginUrl = new URL(expectedOrigin);
  } catch {
    throw new CovalApiError('INVALID_DELEGATION', 'Sofia delegation origin is misconfigured');
  }
  if (
    apiUrl.protocol !== 'https:' ||
    expectedOriginUrl.protocol !== 'https:' ||
    expectedOriginUrl.origin !== expectedOrigin ||
    expectedOriginUrl.hostname === apiUrl.hostname ||
    endpoint.origin !== expectedOrigin ||
    endpoint.pathname !== '/v1/external/delegations' ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new CovalApiError('INVALID_DELEGATION', 'Sofia delegation response was invalid');
  }
  return endpoint.toString();
}

function parseSofiaConsultation(payload: unknown): SofiaConsultationResponse {
  if (typeof payload !== 'object' || payload === null) {
    throw new CovalApiError('INVALID_COVI_RESPONSE', 'Sofia returned an invalid response');
  }
  const candidate = payload as Partial<SofiaConsultationResponse>;
  if (
    candidate.contract_version !== '1' ||
    typeof candidate.request_id !== 'string' ||
    !candidate.request_id ||
    candidate.mode !== 'read_only' ||
    typeof candidate.summary !== 'string' ||
    !candidate.summary.trim() ||
    !Array.isArray(candidate.evidence) ||
    !Array.isArray(candidate.proposed_actions) ||
    candidate.proposed_actions.length !== 0
  ) {
    throw new CovalApiError('INVALID_COVI_RESPONSE', 'Sofia returned an invalid response');
  }
  const evidence = candidate.evidence.filter(
    (item): item is { name: string; status: string } =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.name === 'string' &&
      typeof item.status === 'string'
  );
  if (evidence.length !== candidate.evidence.length) {
    throw new CovalApiError('INVALID_COVI_RESPONSE', 'Sofia returned invalid evidence');
  }
  return { ...candidate, evidence } as SofiaConsultationResponse;
}
