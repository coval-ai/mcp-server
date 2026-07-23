import { CovalApiClient } from "../../src/client.js";
import { jest } from "@jest/globals";

const originalSofiaDelegationOrigin = process.env.SOFIA_DELEGATION_ORIGIN;
const originalCoviDelegationOrigin = process.env.COVI_DELEGATION_ORIGIN;

describe("CovalApiClient.consultSofia", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    restoreEnvironmentVariable('SOFIA_DELEGATION_ORIGIN', originalSofiaDelegationOrigin);
    restoreEnvironmentVariable('COVI_DELEGATION_ORIGIN', originalCoviDelegationOrigin);
  });

  it("exchanges the API key for a delegation token and never forwards that key to Sofia", async () => {
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            delegation_token: "v1.signed.token",
            delegation_url: "https://sofia.example.com/v1/external/delegations",
            expires_at: 1234,
            mode: "read_only",
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            contract_version: "1",
            request_id: "request-123",
            mode: "read_only",
            summary: "Inspect run run_123 first.",
            evidence: [{ name: "list_recent_runs", status: "succeeded" }],
            proposed_actions: [],
          }),
          { status: 200 },
        ),
      );

    const client = new CovalApiClient(
      "customer-api-key",
      "https://api.example.com/v1",
    );
    const result = await client.consultSofia({
      prompt: "What should I inspect?",
      conversation: [{ role: "assistant", content: "I can help." }],
      sessionId: "codex-session-1",
    });

    expect(result).toEqual({
      contractVersion: "1",
      requestId: "request-123",
      mode: "read_only",
      summary: "Inspect run run_123 first.",
      evidence: [{ name: "list_recent_runs", status: "succeeded" }],
      proposedActions: [],
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/covi/delegation-token",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: expect.objectContaining({ "X-API-Key": "customer-api-key" }),
    });
    expect(fetchMock.mock.calls[0][1]?.signal).toBeDefined();
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://sofia.example.com/v1/external/delegations",
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      headers: expect.objectContaining({
        Authorization: "Bearer v1.signed.token",
      }),
    });
    expect(fetchMock.mock.calls[1][1]?.headers).not.toHaveProperty("X-API-Key");
    expect(fetchMock.mock.calls[1][1]?.headers?.Authorization).not.toContain("customer-api-key");
    expect(fetchMock.mock.calls[1][1]?.signal).toBeDefined();
  });

  it("rejects a delegation URL outside the expected Sofia origin before sending the bearer", async () => {
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          delegation_token: "v1.signed.token",
          delegation_url: "https://attacker.example.com/v1/external/delegations",
          expires_at: 1234,
          mode: "read_only",
        }),
        { status: 200 },
      ),
    );
    const client = new CovalApiClient("customer-api-key", "https://api.example.com/v1");

    await expect(client.consultSofia({ prompt: "What should I inspect?" })).rejects.toMatchObject({
      code: "INVALID_DELEGATION",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('accepts the dedicated staging Sofia origin for a staging API base path', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            delegation_token: 'signed.jwt.token',
            delegation_url: 'https://sofia-staging.coval.dev/v1/external/delegations',
            expires_at: 1234,
            mode: 'read_only',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            contract_version: '1',
            request_id: 'request-staging',
            mode: 'read_only',
            summary: 'Staging consultation.',
            evidence: [],
            proposed_actions: [],
          }),
          { status: 200 },
        ),
      );
    const client = new CovalApiClient('staging-key', 'https://api.coval.dev/v1-staging');

    await client.consultSofia({ prompt: 'Inspect staging.' });

    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://sofia-staging.coval.dev/v1/external/delegations',
    );
  });

  it('bounds the delegation-token exchange', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new DOMException('timed out', 'AbortError'));
    const client = new CovalApiClient('customer-api-key', 'https://api.example.com/v1');

    await expect(client.consultSofia({ prompt: 'Inspect the latest run.' })).rejects.toMatchObject({
      code: 'COVI_UNAVAILABLE',
      message: 'Sofia delegation was unavailable',
    });
  });

  it('prefers SOFIA_DELEGATION_ORIGIN over COVI_DELEGATION_ORIGIN', async () => {
    process.env.SOFIA_DELEGATION_ORIGIN = 'https://sofia-primary.example.com';
    process.env.COVI_DELEGATION_ORIGIN = 'https://sofia-legacy.example.com';
    const fetchMock = mockSuccessfulConsultation('https://sofia-primary.example.com/v1/external/delegations');
    const client = new CovalApiClient('customer-api-key', 'https://api.example.com/v1');

    await client.consultSofia({ prompt: 'Inspect the latest run.' });

    expect(fetchMock.mock.calls[1][0]).toBe('https://sofia-primary.example.com/v1/external/delegations');
  });

  it('falls back to COVI_DELEGATION_ORIGIN when SOFIA_DELEGATION_ORIGIN is unset', async () => {
    delete process.env.SOFIA_DELEGATION_ORIGIN;
    process.env.COVI_DELEGATION_ORIGIN = 'https://sofia-legacy.example.com';
    const fetchMock = mockSuccessfulConsultation('https://sofia-legacy.example.com/v1/external/delegations');
    const client = new CovalApiClient('customer-api-key', 'https://api.example.com/v1');

    await client.consultSofia({ prompt: 'Inspect the latest run.' });

    expect(fetchMock.mock.calls[1][0]).toBe('https://sofia-legacy.example.com/v1/external/delegations');
  });

  it('uses the typed unavailable error for a null non-OK consultation payload', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(delegationTokenResponse('https://sofia.example.com/v1/external/delegations'))
      .mockResolvedValueOnce(new Response('null', { status: 503 }));
    const client = new CovalApiClient('customer-api-key', 'https://api.example.com/v1');

    await expect(client.consultSofia({ prompt: 'Inspect the latest run.' })).rejects.toMatchObject({
      code: 'COVI_UNAVAILABLE',
      message: 'Sofia consultation failed',
      status: 503,
    });
  });

  it('preserves a structured non-OK consultation error', async () => {
    const details = [{ field: 'prompt', description: 'Prompt is required.' }];
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(delegationTokenResponse('https://sofia.example.com/v1/external/delegations'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: 'INVALID_PROMPT', message: 'Invalid prompt', details } }),
          { status: 400 },
        ),
      );
    const client = new CovalApiClient('customer-api-key', 'https://api.example.com/v1');

    await expect(client.consultSofia({ prompt: '' })).rejects.toMatchObject({
      code: 'INVALID_PROMPT',
      message: 'Invalid prompt',
      details,
      status: 400,
    });
  });

  it('rejects null consultation payloads with the typed response error', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            delegation_token: 'signed.jwt.token',
            delegation_url: 'https://sofia.example.com/v1/external/delegations',
            expires_at: 1234,
            mode: 'read_only',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response('null', { status: 200 }));
    const client = new CovalApiClient('customer-api-key', 'https://api.example.com/v1');

    await expect(client.consultSofia({ prompt: 'Inspect the latest run.' })).rejects.toMatchObject({
      code: 'INVALID_COVI_RESPONSE',
    });
  });
});

function delegationTokenResponse(delegationUrl: string): Response {
  return new Response(
    JSON.stringify({
      delegation_token: 'signed.jwt.token',
      delegation_url: delegationUrl,
      expires_at: 1234,
      mode: 'read_only',
    }),
    { status: 200 },
  );
}

function mockSuccessfulConsultation(delegationUrl: string) {
  return jest
    .spyOn(global, 'fetch')
    .mockResolvedValueOnce(delegationTokenResponse(delegationUrl))
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          contract_version: '1',
          request_id: 'request-123',
          mode: 'read_only',
          summary: 'Inspect run run_123 first.',
          evidence: [],
          proposed_actions: [],
        }),
        { status: 200 },
      ),
    );
}

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
