import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { jest } from '@jest/globals';
import { CovalApiClient } from '../../src/client.js';
import { registerRunTools } from '../../src/tools/runs.js';
import type { ToolAnnotationProfile } from '../../src/tools/annotations.js';

type ToolHandler = (params: Record<string, unknown>) => Promise<CallToolResult>;

interface ToolRegistration {
  description?: string;
}

function responsePayload(result: CallToolResult): Record<string, unknown> {
  const content = result.content[0];
  if (content?.type !== 'text') throw new Error('Expected a text tool response');
  return JSON.parse(content.text) as Record<string, unknown>;
}

function registerCreateRunTool(
  annotationProfile: ToolAnnotationProfile,
  agentResponse: unknown
) {
  let registration: ToolRegistration | undefined;
  let handler: ToolHandler | undefined;
  const server = {
    registerTool: (name: string, config: ToolRegistration, toolHandler: ToolHandler) => {
      if (name !== 'create_run') return;
      registration = config;
      handler = toolHandler;
    },
  } as unknown as McpServer;
  const getAgent = jest.fn(async () => agentResponse);
  const createRun = jest.fn(async (payload: unknown) => ({
    run: { id: 'run_example', payload },
  }));
  const client = { getAgent, createRun } as unknown as CovalApiClient;

  registerRunTools(server, client, { annotationProfile });
  if (!handler || !registration) throw new Error('create_run was not registered');
  return { createRun, getAgent, handler, registration };
}

const createRunParams = {
  agent_id: 'agent_example',
  persona_id: 'persona_example',
  test_set_id: 'test_set_example',
  tags: ['directory-review'],
  metadata: { source: 'test' },
};

describe('Claude create_run audio policy', () => {
  it.each([
    'MODEL_TYPE_VOICE',
    'MODEL_TYPE_OUTBOUND_VOICE',
    'MODEL_TYPE_WEBSOCKET',
  ])(
    'blocks %s before creating a run',
    async (modelType) => {
      const { createRun, getAgent, handler } = registerCreateRunTool('claude', {
        agent: { model_type: modelType },
      });

      const result = await handler(createRunParams);

      expect(getAgent).toHaveBeenCalledWith(createRunParams.agent_id);
      expect(createRun).not.toHaveBeenCalled();
      expect(result.isError).toBe(true);
      expect(responsePayload(result)).toEqual({
        error: 'CLAUDE_AUDIO_RUN_UNSUPPORTED',
        message:
          'The Claude directory connector cannot start voice, outbound voice, or WebSocket voice evaluation runs.',
        suggestion:
          'Use a MODEL_TYPE_CHAT or MODEL_TYPE_SMS agent, or start the audio run directly in Coval.',
      });
    }
  );

  it.each([
    'MODEL_TYPE_CHAT',
    'MODEL_TYPE_SMS',
  ])('allows %s runs after verifying the agent type', async (modelType) => {
    const { createRun, getAgent, handler } = registerCreateRunTool('claude', {
      agent: { model_type: modelType },
    });

    const result = await handler(createRunParams);

    expect(getAgent).toHaveBeenCalledWith(createRunParams.agent_id);
    expect(createRun).toHaveBeenCalledWith({
      agent_id: 'agent_example',
      persona_id: 'persona_example',
      test_set_id: 'test_set_example',
      metadata: {
        source: 'test',
        tags: ['directory-review'],
      },
    });
    expect(result.isError).not.toBe(true);
  });

  it.each([
    ['a missing agent envelope', {}],
    ['an unknown model type', { agent: { model_type: 'MODEL_TYPE_FUTURE_AUDIO' } }],
  ])('fails closed for %s', async (_case, agentResponse) => {
    const { createRun, handler } = registerCreateRunTool('claude', agentResponse);

    const result = await handler(createRunParams);

    expect(createRun).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(responsePayload(result)).toEqual({
      error: 'CLAUDE_AGENT_TYPE_UNVERIFIED',
      message: 'The agent type could not be verified, so the run was not created.',
      suggestion: 'Choose a verified MODEL_TYPE_CHAT or MODEL_TYPE_SMS agent.',
    });
  });

  it('does not create a run when the agent preflight request fails', async () => {
    const { createRun, getAgent, handler } = registerCreateRunTool('claude', {
      agent: { model_type: 'MODEL_TYPE_CHAT' },
    });
    getAgent.mockRejectedValueOnce(new Error('SYNTHETIC_PREFLIGHT_FAILURE'));

    const result = await handler(createRunParams);

    expect(createRun).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(responsePayload(result)).toEqual({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    });
    expect(JSON.stringify(responsePayload(result))).not.toContain(
      'SYNTHETIC_PREFLIGHT_FAILURE'
    );
  });

  it('preserves standard route behavior without an agent preflight', async () => {
    const { createRun, getAgent, handler } = registerCreateRunTool('standard', {
      agent: { model_type: 'MODEL_TYPE_VOICE' },
    });

    const result = await handler(createRunParams);

    expect(getAgent).not.toHaveBeenCalled();
    expect(createRun).toHaveBeenCalledTimes(1);
    expect(result.isError).not.toBe(true);
  });

  it('discloses the restriction only in the Claude tool description', () => {
    const claude = registerCreateRunTool('claude', {
      agent: { model_type: 'MODEL_TYPE_CHAT' },
    });
    const standard = registerCreateRunTool('standard', {
      agent: { model_type: 'MODEL_TYPE_CHAT' },
    });

    expect(claude.registration.description).toContain(
      'does not start voice, outbound voice, or WebSocket voice runs'
    );
    expect(standard.registration.description).not.toContain(
      'does not start voice, outbound voice, or WebSocket voice runs'
    );
  });
});
