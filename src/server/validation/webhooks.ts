import { z } from 'zod';

export const PaymentWebhookSchema = z.object({
  providerReference: z.string().trim().min(1),
  event: z.enum(['payment.captured', 'payment.failed']),
  // The provider's own event-level identifier (distinct from `providerReference`, which names
  // the payment) - required so a captured event can be recognized as "already processed" even
  // after the payment's own status has since moved on for an unrelated reason (section 9's
  // "replay outside the idempotency window" concern).
  eventId: z.string().trim().min(1),
});
