import { handler } from "../../src/lambda.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jest } from "@jest/globals";

describe("remote MCP Lambda", () => {
  it("uses the package version in health and initialize responses", async () => {
    const health = await handler({
      rawPath: "/health",
      requestContext: { http: { method: "GET" } },
      headers: {},
    } as Parameters<typeof handler>[0]);
    expect(JSON.parse(health.body).version).toBe("0.2.0");

    const initialize = await handler({
      rawPath: "/mcp",
      requestContext: { http: { method: "POST" } },
      headers: { accept: "application/json", "x-api-key": "customer-api-key" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      isBase64Encoded: false,
    } as Parameters<typeof handler>[0]);
    expect(JSON.parse(initialize.body).result.serverInfo.version).toBe("0.2.0");
  });

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

  it("describes only the capabilities available to the current server", async () => {
    const readOverview = async (apiKey?: string) =>
      handler({
        rawPath: "/mcp",
        requestContext: { http: { method: "POST" } },
        headers: {
          accept: "application/json",
          ...(apiKey ? { "x-api-key": apiKey } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "resources/read",
          params: { uri: "coval://overview" },
        }),
        isBase64Encoded: false,
      } as Parameters<typeof handler>[0]);

    const authenticated = JSON.parse((await readOverview("customer-api-key")).body).result
      .contents[0].text;
    expect(authenticated).toContain("Use direct tools");
    expect(authenticated).not.toContain("consult_covi");

    const unauthenticated = JSON.parse((await readOverview()).body).result.contents[0].text;
    expect(unauthenticated).toContain("Authenticate to access");
    expect(unauthenticated).not.toContain("direct tools");
  });

  it("closes the in-memory transport after notifications and request failures", async () => {
    const clientClose = jest.spyOn(Client.prototype, "close");
    const serverClose = jest.spyOn(McpServer.prototype, "close");
    const handlerError = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const notification = await handler({
      rawPath: "/mcp",
      requestContext: { http: { method: "POST" } },
      headers: { accept: "application/json", "x-api-key": "customer-api-key" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      isBase64Encoded: false,
    } as Parameters<typeof handler>[0]);

    expect(notification.statusCode).toBe(202);
    expect(clientClose).toHaveBeenCalledTimes(1);
    expect(serverClose).toHaveBeenCalledTimes(1);

    const listTools = jest
      .spyOn(Client.prototype, "listTools")
      .mockRejectedValueOnce(new Error("request failed"));
    const failure = await handler({
      rawPath: "/mcp",
      requestContext: { http: { method: "POST" } },
      headers: { accept: "application/json", "x-api-key": "customer-api-key" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      isBase64Encoded: false,
    } as Parameters<typeof handler>[0]);

    expect(JSON.parse(failure.body).error.message).toBe("request failed");
    expect(clientClose).toHaveBeenCalledTimes(2);
    expect(serverClose).toHaveBeenCalledTimes(2);

    listTools.mockRestore();
    clientClose.mockRestore();
    serverClose.mockRestore();
    handlerError.mockRestore();
  });
});
