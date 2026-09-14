import { z } from 'zod';

export const SetCartQuantitySchema = z.object({
  quantity: z.number().int().min(0),
});
