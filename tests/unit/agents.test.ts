import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { jest } from '@jest/globals';
import { CovalApiClient } from '../../src/client.js';
import { registerAgentTools } from '../../src/tools/agents.js';

type ToolHandler = (params: Record<string, unknown>) => Promise<CallToolResult>;
type AgentResponses = {
  list: unknown;
  get: unknown;
  create: unknown;
  update: unknown;
};

const safeAgent = {
  id: 'agent_example',
  display_name: 'Example agent',
  model_type: 'MODEL_TYPE_CHAT',
  phone_number: null,
  language: 'en-US',
  metric_ids: ['metric_example'],
  test_set_ids: ['test_set_example'],
  knowledge_base_ids: ['knowledge_base_example'],
};

function upstreamAgent(endpoint: unknown, id = safeAgent.id): Record<string, unknown> {
  return {
    ...safeAgent,
    id,
    endpoint,
    create_time: '2026-01-01T00:00:00Z',
    update_time: '2026-01-02T00:00:00Z',
    tags: ['api_key=SYNTHETIC_CREDENTIAL_MARKER'],
    prompt: 'FAKE_SENSITIVE_PROMPT',
    metadata: {
      nested: {
        credentials: 'FAKE_SENSITIVE_METADATA',
      },
    },
    attributes: {
      arbitrary: 'FAKE_SENSITIVE_ATTRIBUTE',
    },
    workflows: {
      arbitrary: 'FAKE_SENSITIVE_WORKFLOW',
    },
    arbitrary_nested: {
      value: 'FAKE_SENSITIVE_ARBITRARY_FIELD',
    },
  };
}

function upstreamAgentWithout(field: keyof typeof safeAgent): Record<string, unknown> {
  const agent = upstreamAgent(null);
  delete agent[field];
  return agent;
}

function responsePayload(result: CallToolResult): Record<string, unknown> {
  const content = result.content[0];
  if (content?.type !== 'text') throw new Error('Expected a text tool response');
  return JSON.parse(content.text) as Record<string, unknown>;
}

function registerHandlers(overrides: Partial<AgentResponses> = {}): Map<string, ToolHandler> {
  const responses: AgentResponses = {
    list: { agents: [upstreamAgent(null)] },
    get: { agent: upstreamAgent(null) },
    create: { agent: upstreamAgent(null) },
    update: { agent: upstreamAgent(null) },
    ...overrides,
  };
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool: (_name: string, _config: unknown, handler: ToolHandler) => {
      handlers.set(_name, handler);
    },
  } as unknown as McpServer;
  const client = {
    listAgents: async () => responses.list,
    getAgent: async () => responses.get,
    createAgent: async () => responses.create,
    updateAgent: async () => responses.update,
  } as unknown as CovalApiClient;

  registerAgentTools(server, client);
  return handlers;
}

function expectInvalidApiResponse(result: CallToolResult): void {
  expect(result.isError).toBe(true);
  expect(responsePayload(result)).toEqual({
    error: 'INVALID_API_RESPONSE',
    message: 'The Coval API returned an invalid response.',
  });
}

describe('agent tool response projection', () => {
  it('omits tags and endpoint contents across all four tools while preserving endpoint presence', async () => {
    const handlers = registerHandlers({
      list: {
        agents: [
          upstreamAgent(
            'https://hooks.example.invalid/services/account/SYNTHETIC_CREDENTIAL_MARKER'
          ),
          upstreamAgent('not a valid endpoint', 'agent_malformed'),
          upstreamAgent('', 'agent_empty'),
          upstreamAgent('   ', 'agent_whitespace'),
          upstreamAgent(null, 'agent_null'),
          upstreamAgent(
            { nested: 'SYNTHETIC_CREDENTIAL_MARKER' },
            'agent_non_string'
          ),
        ],
        next_page_token: 'page_example',
        arbitrary_top_level: 'FAKE_SENSITIVE_LIST_FIELD',
      },
      get: {
        agent: upstreamAgent(
          'https://hooks.example.invalid/get/SYNTHETIC_CREDENTIAL_MARKER',
          'agent_get'
        ),
        arbitrary_top_level: 'FAKE_SENSITIVE_GET_FIELD',
      },
      create: {
        agent: upstreamAgent(
          'https://hooks.example.invalid/create/SYNTHETIC_CREDENTIAL_MARKER',
          'agent_create'
        ),
        arbitrary_top_level: 'FAKE_SENSITIVE_CREATE_FIELD',
      },
      update: {
        agent: upstreamAgent(
          'https://hooks.example.invalid/update/SYNTHETIC_CREDENTIAL_MARKER',
          'agent_update'
        ),
        arbitrary_top_level: 'FAKE_SENSITIVE_UPDATE_FIELD',
      },
    });

    const listResult = responsePayload(await handlers.get('list_agents')!({}));
    const getResult = responsePayload(
      await handlers.get('get_agent')!({ agent_id: 'agent_get' })
    );
    const createResult = responsePayload(
      await handlers.get('create_agent')!({
        display_name: 'Example agent',
        model_type: 'MODEL_TYPE_CHAT',
        endpoint: 'https://chat.example.com/messages',
      })
    );
    const updateResult = responsePayload(
      await handlers.get('update_agent')!({
        agent_id: 'agent_update',
        display_name: 'Updated example agent',
      })
    );

    expect(listResult).toEqual({
      agents: [
        { ...safeAgent, endpoint_configured: true },
        { ...safeAgent, id: 'agent_malformed', endpoint_configured: true },
        { ...safeAgent, id: 'agent_empty', endpoint_configured: false },
        { ...safeAgent, id: 'agent_whitespace', endpoint_configured: false },
        { ...safeAgent, id: 'agent_null', endpoint_configured: false },
        { ...safeAgent, id: 'agent_non_string', endpoint_configured: false },
      ],
      next_page_token: 'page_example',
    });
    expect(getResult).toEqual({
      agent: { ...safeAgent, id: 'agent_get', endpoint_configured: true },
    });
    expect(createResult).toEqual({
      agent: { ...safeAgent, id: 'agent_create', endpoint_configured: true },
    });
    expect(updateResult).toEqual({
      agent: { ...safeAgent, id: 'agent_update', endpoint_configured: true },
    });

    for (const result of [listResult, getResult, createResult, updateResult]) {
      expect(JSON.stringify(result)).not.toContain('FAKE_SENSITIVE');
      expect(JSON.stringify(result)).not.toContain('SYNTHETIC_CREDENTIAL_MARKER');
      const agents = 'agents' in result ? result.agents : [result.agent];
      for (const agent of agents as Array<Record<string, unknown>>) {
        expect(agent).not.toHaveProperty('endpoint');
        expect(agent).not.toHaveProperty('tags');
        expect(agent).not.toHaveProperty('metadata');
        expect(agent).not.toHaveProperty('attributes');
        expect(agent).not.toHaveProperty('workflows');
        expect(agent).not.toHaveProperty('prompt');
        expect(agent).not.toHaveProperty('arbitrary_nested');
        expect(agent).not.toHaveProperty('create_time');
        expect(agent).not.toHaveProperty('update_time');
      }
    }
  });

  it.each([
    ['missing response object', null],
    ['missing agents field', {}],
    ['non-array agents field', { agents: 'FAKE_SENSITIVE_MALFORMED_AGENTS' }],
    [
      'agent missing a required public field',
      {
        agents: [
          {
            display_name: 'Example agent',
            model_type: 'MODEL_TYPE_CHAT',
            endpoint: 'FAKE_SENSITIVE_MALFORMED_ENDPOINT',
          },
        ],
      },
    ],
    [
      'malformed relationship IDs',
      {
        agents: [
          {
            ...upstreamAgent(null),
            metric_ids: ['metric_example', { secret: 'FAKE_SENSITIVE_MALFORMED_ID' }],
          },
        ],
      },
    ],
    ['missing metric IDs', { agents: [upstreamAgentWithout('metric_ids')] }],
    ['missing test set IDs', { agents: [upstreamAgentWithout('test_set_ids')] }],
    [
      'missing knowledge base IDs',
      { agents: [upstreamAgentWithout('knowledge_base_ids')] },
    ],
    [
      'malformed pagination token',
      {
        agents: [upstreamAgent(null)],
        next_page_token: { secret: 'FAKE_SENSITIVE_MALFORMED_PAGE_TOKEN' },
      },
    ],
  ])('fails closed for list_agents with %s', async (_name, listResponse) => {
    const handlers = registerHandlers({ list: listResponse });
    const result = await handlers.get('list_agents')!({});

    expectInvalidApiResponse(result);
    expect(JSON.stringify(responsePayload(result))).not.toContain('FAKE_SENSITIVE');
  });

  it.each([
    [
      'get_agent',
      'get',
      { agent_id: 'agent_get' },
      {
        agent: {
          id: 'agent_get',
          display_name: 'Example agent',
          endpoint: 'FAKE_SENSITIVE_MALFORMED_ENDPOINT',
        },
      },
    ],
    [
      'create_agent',
      'create',
      {
        display_name: 'Example agent',
        model_type: 'MODEL_TYPE_CHAT',
        endpoint: 'https://chat.example.com/messages',
      },
      { agent: null, arbitrary: 'FAKE_SENSITIVE_MALFORMED_AGENT' },
    ],
    [
      'update_agent',
      'update',
      { agent_id: 'agent_update', display_name: 'Updated agent' },
      { arbitrary: 'FAKE_SENSITIVE_MISSING_AGENT' },
    ],
  ] as const)(
    'fails closed for malformed %s success envelopes',
    async (toolName, responseKey, params, malformedResponse) => {
      const handlers = registerHandlers({ [responseKey]: malformedResponse });
      const result = await handlers.get(toolName)!({ ...params });

      expectInvalidApiResponse(result);
      expect(JSON.stringify(responsePayload(result))).not.toContain('FAKE_SENSITIVE');
    }
  );
});

describe('create_agent payload construction', () => {
  it.each([
    [
      {
        display_name: 'Voice agent',
        model_type: 'MODEL_TYPE_VOICE',
        phone_number: 'sip:reviewer@invalid.example',
      },
      {
        display_name: 'Voice agent',
        model_type: 'MODEL_TYPE_VOICE',
        phone_number: 'sip:reviewer@invalid.example',
      },
    ],
    [
      {
        display_name: 'Chat agent',
        model_type: 'MODEL_TYPE_CHAT',
        endpoint: 'https://chat.example.com/messages',
      },
      {
        display_name: 'Chat agent',
        model_type: 'MODEL_TYPE_CHAT',
        metadata: { chat_endpoint: 'https://chat.example.com/messages' },
      },
    ],
    [
      {
        display_name: 'WebSocket agent',
        model_type: 'MODEL_TYPE_WEBSOCKET',
        endpoint: 'wss://voice.example.com/socket',
      },
      {
        display_name: 'WebSocket agent',
        model_type: 'MODEL_TYPE_WEBSOCKET',
        metadata: { endpoint: 'wss://voice.example.com/socket' },
      },
    ],
  ])('sends only the model-specific connection config', async (params, expectedPayload) => {
    let handler: ToolHandler | undefined;
    const server = {
      registerTool: (name: string, _config: unknown, registeredHandler: ToolHandler) => {
        if (name === 'create_agent') handler = registeredHandler;
      },
    } as unknown as McpServer;
    const createAgent = jest.fn(async () => ({ agent: upstreamAgent(null) }));
    const client = { createAgent } as unknown as CovalApiClient;

    registerAgentTools(server, client, { inputProfile: 'openai' });
    expect(handler).toBeDefined();

    await handler!(params);

    expect(createAgent).toHaveBeenCalledWith(expectedPayload);
  });

  it.each([
    [
      {
        display_name: 'Voice agent',
        model_type: 'MODEL_TYPE_VOICE',
      },
      'MODEL_TYPE_VOICE requires an E.164 phone number or SIP address.',
    ],
    [
      {
        display_name: 'SMS agent',
        model_type: 'MODEL_TYPE_SMS',
        phone_number: 'sip:reviewer@invalid.example',
      },
      'MODEL_TYPE_SMS requires an E.164 phone number.',
    ],
    [
      {
        display_name: 'WebSocket agent',
        model_type: 'MODEL_TYPE_WEBSOCKET',
        endpoint: 'https://voice.example.com/socket',
      },
      'MODEL_TYPE_WEBSOCKET requires a secure WSS endpoint.',
    ],
  ])('rejects incomplete model-specific config before the API call', async (params, message) => {
    let handler: ToolHandler | undefined;
    const server = {
      registerTool: (name: string, _config: unknown, registeredHandler: ToolHandler) => {
        if (name === 'create_agent') handler = registeredHandler;
      },
    } as unknown as McpServer;
    const createAgent = jest.fn(async () => ({ agent: upstreamAgent(null) }));
    const client = { createAgent } as unknown as CovalApiClient;

    registerAgentTools(server, client, { inputProfile: 'openai' });
    const result = await handler!(params);

    expect(createAgent).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(responsePayload(result)).toMatchObject({
      error: 'INVALID_AGENT_CONFIGURATION',
      message,
    });
  });
});

describe('update_agent payload construction', () => {
  it('merges a narrow chat endpoint into the existing metadata', async () => {
    let handler: ToolHandler | undefined;
    const server = {
      registerTool: (name: string, _config: unknown, registeredHandler: ToolHandler) => {
        if (name === 'update_agent') handler = registeredHandler;
      },
    } as unknown as McpServer;
    const getAgent = jest.fn(async () => ({
      agent: {
        model_type: 'MODEL_TYPE_CHAT',
        metadata: {
          authorization_header: 'Bearer preserved',
          chat_endpoint: 'https://old.example.com/messages',
        },
      },
    }));
    const updateAgent = jest.fn(async () => ({ agent: upstreamAgent(null) }));
    const client = { getAgent, updateAgent } as unknown as CovalApiClient;

    registerAgentTools(server, client, { inputProfile: 'openai' });
    await handler!({
      agent_id: 'agent_example',
      chat_endpoint: 'https://new.example.com/messages',
    });

    expect(getAgent).toHaveBeenCalledWith('agent_example');
    expect(updateAgent).toHaveBeenCalledWith('agent_example', {
      metadata: {
        authorization_header: 'Bearer preserved',
        chat_endpoint: 'https://new.example.com/messages',
      },
    });
  });
});
