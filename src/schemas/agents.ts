import { z } from 'zod';
import { PaginationInputSchema, ResourceIdSchema } from './common.js';

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
  agent_id: ResourceIdSchema.describe('The unique ID of the agent to retrieve.'),
}).strict();

const AgentNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .describe('Human-readable name for the agent');

const AgentPromptSchema = z
  .string()
  .trim()
  .min(1)
  .max(12000)
  .optional()
  .describe('Optional system prompt or instructions for the agent');

const E164PhoneNumberSchema = z
  .string()
  .regex(/^\+[1-9]\d{9,19}$/)
  .max(21)
  .describe('Phone number in E.164 format, such as +14155550123');

const SipAddressSchema = z
  .string()
  .regex(/^sip:[^@\s]+@[^@\s]+\.[^@\s]+$/)
  .max(200)
  .describe('SIP address, such as sip:agent@example.com');

const VoicePhoneNumberSchema = z.union([
  E164PhoneNumberSchema,
  SipAddressSchema,
]).describe('Required E.164 phone number or SIP address for the voice agent');

function usesProtocol(value: string, protocols: readonly string[]): boolean {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const HttpEndpointSchema = z
  .string()
  .url()
  .max(200)
  .refine((value) => usesProtocol(value, ['http:', 'https:']), {
    message: 'Endpoint must use http or https',
  });

const WebSocketEndpointSchema = z
  .string()
  .url()
  .max(200)
  .refine((value) => usesProtocol(value, ['wss:']), {
    message: 'Endpoint must use wss',
  });

const AgentBaseShape = {
  display_name: AgentNameSchema,
  model_type: ModelTypeEnum.describe(
    'Agent type. VOICE requires phone_number; SMS requires an E.164 phone_number; OUTBOUND_VOICE and CHAT require an HTTP(S) endpoint; WEBSOCKET requires a WSS endpoint.',
  ),
  prompt: AgentPromptSchema,
};

export const CreateAgentInputSchema = z.object({
  ...AgentBaseShape,
  phone_number: VoicePhoneNumberSchema.optional().describe(
    'Required for VOICE (E.164 or SIP) and SMS (E.164 only); omit for other model types',
  ),
  endpoint: z.union([HttpEndpointSchema, WebSocketEndpointSchema]).optional().describe(
    'Required HTTP(S) endpoint for OUTBOUND_VOICE or CHAT, or WSS endpoint for WEBSOCKET; omit for VOICE and SMS',
  ),
}).strict().describe(
  'Create an agent with the connection field required by its model type',
);

export const UpdateAgentInputSchema = z.object({
  agent_id: ResourceIdSchema.describe('The unique ID of the agent to update'),
  display_name: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe('New display name'),
  phone_number: VoicePhoneNumberSchema.optional().describe(
    'New E.164 phone number or SIP address for a VOICE or SMS agent',
  ),
  outbound_voice_endpoint: HttpEndpointSchema
    .optional()
    .describe('New HTTP(S) webhook endpoint for an OUTBOUND_VOICE agent'),
  chat_endpoint: HttpEndpointSchema
    .optional()
    .describe('New HTTP(S) message endpoint for a CHAT agent'),
  websocket_endpoint: WebSocketEndpointSchema
    .optional()
    .describe('New WSS connection endpoint for a WEBSOCKET agent'),
  prompt: z
    .string()
    .trim()
    .min(1)
    .max(12000)
    .optional()
    .describe('New system prompt'),
}).strict();

export const LegacyCreateAgentInputSchema = z.object({
  display_name: z
    .string()
    .min(1)
    .max(200)
    .describe('Human-readable name for the agent'),
  model_type: ModelTypeEnum.describe(
    'Type of agent: MODEL_TYPE_VOICE, MODEL_TYPE_CHAT, MODEL_TYPE_SMS, etc.',
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

export const LegacyUpdateAgentInputSchema = z.object({
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
export type LegacyCreateAgentInput = z.infer<typeof LegacyCreateAgentInputSchema>;
export type LegacyUpdateAgentInput = z.infer<typeof LegacyUpdateAgentInputSchema>;
