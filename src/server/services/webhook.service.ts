import 'server-only';
import crypto from 'node:crypto';
import { db } from '@/server/db';
import { env } from '@/server/env';
import { fail, ok } from '@/services/base';
import type { ServiceResult } from '@/types/common';

/**
 * Inbound webhook handling for the payment-provider abstraction (Phase 14, Stage 11 - external
 * integrations). None of the mock providers in server/services/payment/providers.ts ever call
 * this today - they all resolve synchronously, so nothing in this app's own flow sends a
 * webhook. This exists so a real gateway (Paystack, Flutterwave, a direct MoMo API integration,
 * ...) can be wired in later by pointing its webhook config at this route and setting
 * PAYMENT_WEBHOOK_SIGNING_SECRET, without touching payment.service.ts's charge() or the
 * checkout/invoice flows that depend on it.
 */

/** Constant-time HMAC-SHA256 signature check over the raw request body - never parse the body
 *  as JSON before verifying, or a byte-for-byte signature mismatch (whitespace, key order) could
 *  slip through. Fails closed (false) if no signing secret is configured at all, so an
 *  unconfigured deployment rejects every webhook rather than silently accepting unsigned ones. */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!env.PAYMENT_WEBHOOK_SIGNING_SECRET || !signatureHeader) return false;

  const expected = crypto.createHmac('sha256', env.PAYMENT_WEBHOOK_SIGNING_SECRET).update(rawBody).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  const receivedBuffer = Buffer.from(signatureHeader, 'hex');
  if (expectedBuffer.length !== receivedBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

export interface PaymentWebhookPayload {
  /** Matches Payment.reference - the id this app's own charge() call originally minted, or the
   *  provider's own reference if the provider assigns one instead (see each PaymentProvider's
   *  own `charge()` for which). */
  providerReference: string;
  event: 'payment.captured' | 'payment.failed';
  /** The provider's own event-level identifier - see PaymentTransaction.providerEventId. */
  eventId: string;
}

/** Idempotent two ways over: a replayed webhook for a payment already in the target status is a
 *  no-op (returns ok with `changed: false`, the ordinary "gateway retries until it gets a 2xx"
 *  case), and separately, an event whose `eventId` has already been recorded is also a no-op
 *  *regardless of the payment's current status* - closing the gap where a captured webhook,
 *  replayed after the payment's status had since moved on for an unrelated reason (e.g. a
 *  refund), could reprocess and flip state back (section 9's "replay outside the idempotency
 *  window" concern). `provider` (the same value already used for the `providerReference` unique
 *  constraint below - `payment.method`, resolved from the payment itself, never from anything
 *  the payload asserts) is looked up before the eventId check for exactly that reason: both
 *  checks need to agree on what "provider" means for the same PaymentTransaction row. */
export async function processPaymentWebhook(payload: PaymentWebhookPayload): Promise<ServiceResult<{ changed: boolean }>> {
  const payment = await db.payment.findUnique({ where: { reference: payload.providerReference } });
  if (!payment) return fail('NOT_FOUND', 'No payment matches this reference.');

  const alreadyProcessed = await db.paymentTransaction.findUnique({
    where: { provider_providerEventId: { provider: payment.method, providerEventId: payload.eventId } },
  });
  if (alreadyProcessed) return ok({ changed: false });

  const newStatus = payload.event === 'payment.captured' ? 'PAID' : 'FAILED';
  if (payment.status === newStatus) return ok({ changed: false });

  await db.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: payment.id }, data: { status: newStatus } });
    await tx.paymentTransaction.create({
      data: {
        paymentId: payment.id,
        provider: payment.method,
        providerReference: payload.providerReference,
        providerEventId: payload.eventId,
        event: 'WEBHOOK_RECEIVED',
        amount: payment.amount,
        rawPayload: payload as never,
      },
    });

    if (newStatus === 'PAID' && payment.invoiceId) {
      const invoice = await tx.invoice.findUnique({ where: { id: payment.invoiceId } });
      if (invoice && invoice.status !== 'PAID') {
        await tx.invoice.update({ where: { id: payment.invoiceId }, data: { amountPaid: invoice.total, status: 'PAID' } });
      }
    }

    // Mirrors the invoice cascade above for a payment made at checkout (createFromPurchaseOrder
    // leaves Order.paymentStatus PENDING for a real mobile money charge that hadn't settled by
    // the time the order was created - see orders.service.ts) - the order's own paymentStatus
    // needs the same confirmation this webhook just gave the invoice.
    if (payment.orderId) {
      const order = await tx.order.findUnique({ where: { id: payment.orderId } });
      if (order && order.paymentStatus !== newStatus) {
        await tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus: newStatus } });
        if (newStatus === 'PAID') {
          await tx.orderTimelineEvent.create({ data: { orderId: payment.orderId, status: 'PAYMENT_CONFIRMED', label: 'Payment confirmed' } });
        }
      }
    }
  });

  return ok({ changed: true });
}
