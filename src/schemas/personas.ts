import { z } from 'zod';
import { PaginationInputSchema } from './common.js';

export const ListPersonasInputSchema = PaginationInputSchema.extend({}).describe(
  'Input for listing simulated personas'
);

export const GetPersonaInputSchema = z.object({
  persona_id: z
    .string()
    .min(1)
    .describe('The unique ID of the persona to retrieve.'),
});

export type ListPersonasInput = z.infer<typeof ListPersonasInputSchema>;
export type GetPersonaInput = z.infer<typeof GetPersonaInputSchema>;
