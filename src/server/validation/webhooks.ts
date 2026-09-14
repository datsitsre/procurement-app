import { z } from 'zod';

export const PaymentWebhookSchema = z.object({
  providerReference: z.string().trim().min(1),
  event: z.enum(['payment.captured', 'payment.failed']),
});
