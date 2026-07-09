const DEFAULT_BASE_URL = 'https://api.coval.dev/v1';

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

export interface CoviConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CoviConsultation {
  answer: string;
  toolSteps: Array<Record<string, unknown>>;
}

interface CoviDelegationTokenResponse {
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
    params?: Record<string, string | number | boolean | undefined>
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
   * Ask the server-side Covi runtime for a read-only, organization-grounded consultation.
   *
   * The customer API key authenticates only the short token exchange. The key is never sent to
   * Sofia; the returned token is audience-, org-, subject-, and time-bound and is used only for
   * this read-only consultation request.
   */
  async consultCovi(input: {
    prompt: string;
    conversation?: CoviConversationMessage[];
    sessionId?: string;
  }): Promise<CoviConsultation> {
    const tokenResponse = await this.request<CoviDelegationTokenResponse>('POST', '/covi/delegation-token', {
      client_id: 'coval-mcp',
      ...(input.sessionId ? { session_id: input.sessionId } : {})
    });
    if (tokenResponse.mode !== 'read_only' || !tokenResponse.delegation_token || !tokenResponse.delegation_url) {
      throw new CovalApiError('INVALID_DELEGATION', 'Covi delegation response was invalid');
    }

    const messages: CoviConversationMessage[] = [
      ...(input.conversation || []),
      { role: 'user', content: input.prompt }
    ];
    const response = await fetch(tokenResponse.delegation_url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenResponse.delegation_token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ model: 'covi-external', messages })
    });
    const payload: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = (payload as { error?: ApiError }).error;
      throw new CovalApiError(
        error?.code || 'COVI_UNAVAILABLE',
        error?.message || 'Covi consultation failed',
        error?.details,
        response.status
      );
    }
    const answer = extractCoviAnswer(payload);
    return {
      answer,
      toolSteps: extractCoviToolSteps(payload)
    };
  }
}

function extractCoviAnswer(payload: unknown): string {
  const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new CovalApiError('INVALID_COVI_RESPONSE', 'Covi returned an invalid response');
  }
  return content;
}

function extractCoviToolSteps(payload: unknown): Array<Record<string, unknown>> {
  const toolSteps = (payload as { tool_steps?: unknown }).tool_steps;
  if (!Array.isArray(toolSteps)) {
    return [];
  }
  return toolSteps.filter((step): step is Record<string, unknown> => typeof step === 'object' && step !== null);
}
