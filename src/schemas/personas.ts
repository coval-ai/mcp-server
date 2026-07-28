import { z } from 'zod';
import { PaginationInputSchema, ResourceIdSchema } from './common.js';

export const ListPersonasInputSchema = PaginationInputSchema.extend({}).describe(
  'Input for listing simulated personas'
);

export const GetPersonaInputSchema = z.object({
  persona_id: ResourceIdSchema.describe('The unique ID of the persona to retrieve.'),
}).strict();

export type ListPersonasInput = z.infer<typeof ListPersonasInputSchema>;
export type GetPersonaInput = z.infer<typeof GetPersonaInputSchema>;
