import { z } from 'zod';
import {
  PaginationInputSchema,
  ResourceIdSchema,
  StrictPaginationInputSchema,
} from './common.js';

export const ListPersonasInputSchema = StrictPaginationInputSchema.extend({}).describe(
  'Input for listing simulated personas'
);

export const LegacyListPersonasInputSchema =
  PaginationInputSchema.extend({}).describe(
    'Input for listing simulated personas',
  );

export const GetPersonaInputSchema = z.object({
  persona_id: ResourceIdSchema.describe('The unique ID of the persona to retrieve.'),
}).strict();

export type ListPersonasInput = z.infer<typeof ListPersonasInputSchema>;
export type LegacyListPersonasInput = z.infer<
  typeof LegacyListPersonasInputSchema
>;
export type GetPersonaInput = z.infer<typeof GetPersonaInputSchema>;
