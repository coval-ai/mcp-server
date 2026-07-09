import { handler } from "../../src/lambda.js";

describe("remote MCP Lambda", () => {
  it("does not advertise consult_covi until it has a long-lived transport", async () => {
    const response = await handler({
      rawPath: "/mcp",
      requestContext: { http: { method: "POST" } },
      headers: { accept: "application/json", "x-api-key": "customer-api-key" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      isBase64Encoded: false,
    } as Parameters<typeof handler>[0]);

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    const names = body.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).not.toContain("consult_covi");
  });
});
