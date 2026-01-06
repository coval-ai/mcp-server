import { z } from 'zod';
import { PaginationInputSchema } from './common.js';

export const ModelTypeEnum = z.enum([
  'MODEL_TYPE_VOICE',
  'MODEL_TYPE_OUTBOUND_VOICE',
  'MODEL_TYPE_CHAT',
  'MODEL_TYPE_SMS',
  'MODEL_TYPE_WEBSOCKET',
]);

export const ListAgentsInputSchema = PaginationInputSchema.extend({}).describe(
  'Input for listing configured agents'
);

export const GetAgentInputSchema = z.object({
  agent_id: z
    .string()
    .min(1)
    .describe('The unique ID of the agent to retrieve. Get this from list_agents.'),
});

export const CreateAgentInputSchema = z.object({
  display_name: z
    .string()
    .min(1)
    .max(200)
    .describe('Human-readable name for the agent'),
  model_type: ModelTypeEnum.describe(
    'Type of agent: MODEL_TYPE_VOICE, MODEL_TYPE_CHAT, MODEL_TYPE_SMS, etc.'
  ),
  phone_number: z
    .string()
    .optional()
    .describe('Phone number for voice agents (E.164 format)'),
  endpoint: z
    .string()
    .url()
    .optional()
    .describe('Webhook or WebSocket endpoint URL'),
  prompt: z
    .string()
    .optional()
    .describe('System prompt or instructions for the agent'),
  metadata: z
    .record(z.unknown())
    .optional()
    .describe('Custom metadata for the agent'),
});

export const UpdateAgentInputSchema = z.object({
  agent_id: z.string().min(1).describe('The unique ID of the agent to update'),
  display_name: z.string().min(1).max(200).optional().describe('New display name'),
  phone_number: z.string().optional().describe('New phone number'),
  endpoint: z.string().url().optional().describe('New endpoint URL'),
  prompt: z.string().optional().describe('New system prompt'),
  metadata: z.record(z.unknown()).optional().describe('New metadata'),
});

export type ListAgentsInput = z.infer<typeof ListAgentsInputSchema>;
export type GetAgentInput = z.infer<typeof GetAgentInputSchema>;
export type CreateAgentInput = z.infer<typeof CreateAgentInputSchema>;
export type UpdateAgentInput = z.infer<typeof UpdateAgentInputSchema>;
