import 'server-only';
import { db } from '@/server/db';
import { fail, ok } from '@/services/base';
import { toPaymentDto } from '@/server/dto/invoices';
import { toPage, type PaginationParams } from '@/server/pagination';
import { paymentProviders } from './payment/providers';
import type { Page, ServiceResult, UUID } from '@/types/common';
import type { Payment, PaymentMethod } from '@/types/orders';

/**
 * The real, database-backed counterpart to src/services/payment.service.ts's mock (Phase 14,
 * Stage 8) - same PaymentProvider abstraction (server/services/payment/providers.ts, ported
 * unchanged), now backed by a real Payment ledger row per charge attempt instead of localStorage,
 * plus an append-only PaymentTransaction event per attempt (section 20's "audit everything that
 * moves money") and idempotency (section 13/section 15): a retried request carrying the same
 * `idempotencyKey` returns the original Payment instead of charging twice.
 */

export interface ChargeInput {
  companyId: UUID;
  supplierId?: UUID;
  amount: number;
  currency: string;
  method: PaymentMethod;
  details: Record<string, string>;
  invoiceId?: UUID;
  orderId?: UUID;
  idempotencyKey?: string;
}

export async function listPayments(companyId: UUID): Promise<ServiceResult<Payment[]>> {
  const payments = await db.payment.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } });
  return ok(payments.map(toPaymentDto));
}

export async function listPaymentsForSupplier(supplierId: UUID): Promise<ServiceResult<Payment[]>> {
  const payments = await db.payment.findMany({ where: { supplierId }, orderBy: { createdAt: 'desc' } });
  return ok(payments.map(toPaymentDto));
}

/** Every payment across every company - the platform admin overview (section 46). Paginated
 *  (section 14) - the single most unbounded-by-construction list in the app, since it has no
 *  tenant scope at all to naturally bound it. `skip`/`take` and the `count` both run inside the
 *  database query, after nothing needs filtering out first (there's no tenant scope to apply
 *  here - PLATFORM_MANAGE itself is the whole authorization story, same as the route's own
 *  permission check), never by loading everything and slicing in application code. */
export async function listAllPayments(pagination: PaginationParams): Promise<ServiceResult<Page<Payment>>> {
  const [payments, total] = await Promise.all([
    db.payment.findMany({ orderBy: { createdAt: 'desc' }, skip: pagination.skip, take: pagination.take }),
    db.payment.count(),
  ]);
  return ok(toPage(payments.map(toPaymentDto), total, pagination));
}

export async function charge(input: ChargeInput): Promise<ServiceResult<Payment>> {
  if (input.idempotencyKey) {
    const existing = await db.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return ok(toPaymentDto(existing));
  }

  const provider = paymentProviders[input.method];
  if (!provider) return fail('UNSUPPORTED_METHOD', `No payment provider is configured for ${input.method}.`);

  // Credit terms checks against the company's real available credit, resolved here - never
  // trusted from client-supplied `details`, unlike the old client mock (which had no server to
  // ask and so had the checkout page compute this itself).
  const details = { ...input.details };
  if (input.method === 'CREDIT_TERMS') {
    const company = await db.company.findUnique({ where: { id: input.companyId } });
    details.creditAvailable = String(company?.creditAvailable ?? 0);
  }

  const reference = `pay-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
  const result = await provider.charge({ amount: input.amount, currency: input.currency, reference, details });

  // PENDING is not a failure - the gateway accepted the request but settlement is asynchronous
  // (a mobile money "request to pay" prompt the customer still has to approve). The Payment row
  // is created PENDING and later flipped PAID/FAILED by processPaymentWebhook (webhook.service.ts)
  // or the reconciliation job (jobs/pendingPaymentSweep.ts) - callers of `charge()` must check
  // the returned Payment's own `status`, not just whether this call was `ok`, before treating an
  // order/invoice as actually paid. See PaymentProvider.ts's comment on PaymentChargeResult.
  const paymentStatus = result.status === 'SUCCEEDED' ? 'PAID' : result.status === 'PENDING' ? 'PENDING' : 'FAILED';
  const transactionEvent = result.status === 'SUCCEEDED' ? 'CAPTURED' : result.status === 'PENDING' ? 'INITIATED' : 'FAILED';

  const payment = await db.$transaction(async (tx) => {
    const created = await tx.payment.create({
      data: {
        companyId: input.companyId,
        supplierId: input.supplierId,
        invoiceId: input.invoiceId,
        orderId: input.orderId,
        amount: input.amount,
        method: input.method,
        status: paymentStatus,
        reference: result.status === 'FAILED' ? reference : result.providerReference,
        idempotencyKey: input.idempotencyKey,
      },
    });
    await tx.paymentTransaction.create({
      data: {
        paymentId: created.id,
        provider: input.method,
        providerReference: result.status === 'FAILED' ? undefined : result.providerReference,
        event: transactionEvent,
        amount: input.amount,
        rawPayload: result.status === 'FAILED' ? { failureReason: result.failureReason } : undefined,
      },
    });
    return created;
  });

  if (result.status === 'FAILED') {
    return fail('PAYMENT_FAILED', result.failureReason ?? 'Payment failed. Please try again or use a different method.');
  }
  return ok(toPaymentDto(payment));
}
