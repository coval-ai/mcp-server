import { CovalApiClient } from "../../src/client.js";
import { jest } from "@jest/globals";

describe("CovalApiClient.consultCovi", () => {
  afterEach(() => {
    jest.restoreAllMocks();
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
            choices: [{ message: { content: "Inspect run run_123 first." } }],
            tool_steps: [{ name: "list_recent_runs", status: "succeeded" }],
          }),
          { status: 200 },
        ),
      );

    const client = new CovalApiClient(
      "customer-api-key",
      "https://api.example.com/v1",
    );
    const result = await client.consultCovi({
      prompt: "What should I inspect?",
      conversation: [{ role: "assistant", content: "I can help." }],
      sessionId: "codex-session-1",
    });

    expect(result).toEqual({
      answer: "Inspect run run_123 first.",
      toolSteps: [{ name: "list_recent_runs", status: "succeeded" }],
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example.com/v1/covi/delegation-token",
    );
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: expect.objectContaining({ "X-API-Key": "customer-api-key" }),
    });
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://sofia.example.com/v1/external/delegations",
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      headers: expect.objectContaining({
        Authorization: "Bearer v1.signed.token",
      }),
    });
    expect(fetchMock.mock.calls[1][1]?.headers).not.toHaveProperty("X-API-Key");
  });
});
