import { z } from 'zod';

export const ResourceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128);

export const PaginationInputSchema = z.object({
  page_size: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Number of results per page (1-100, default 50)'),
  page_token: z
    .string()
    .max(2048)
    .optional()
    .describe('Token for retrieving the next page of results'),
  order_by: z
    .string()
    .max(200)
    .optional()
    .describe('Sort order (e.g., "-create_time" for newest first)'),
  filter: z
    .string()
    .max(1000)
    .optional()
    .describe('Filter expression (e.g., status="COMPLETED")'),
}).strict();

export type PaginationInput = z.infer<typeof PaginationInputSchema>;
