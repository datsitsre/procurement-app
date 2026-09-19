import { z } from 'zod';

export const UpdateUserProfileSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(200).optional(),
  phone: z.string().trim().max(50).optional(),
  avatarUrl: z.string().max(500_000, 'That image is too large - try a smaller photo.').optional(),
});
