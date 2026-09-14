import 'server-only';
import { db } from '@/server/db';
import { fail, ok } from '@/services/base';
import { toPaymentDto } from '@/server/dto/invoices';
import { paymentProviders } from './payment/providers';
import type { ServiceResult, UUID } from '@/types/common';
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

/** Every payment across every company - the platform admin overview (section 46). */
export async function listAllPayments(): Promise<ServiceResult<Payment[]>> {
  const payments = await db.payment.findMany({ orderBy: { createdAt: 'desc' } });
  return ok(payments.map(toPaymentDto));
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

  const payment = await db.$transaction(async (tx) => {
    const created = await tx.payment.create({
      data: {
        companyId: input.companyId,
        supplierId: input.supplierId,
        invoiceId: input.invoiceId,
        orderId: input.orderId,
        amount: input.amount,
        method: input.method,
        status: result.success ? 'PAID' : 'FAILED',
        reference: result.success ? result.providerReference : reference,
        idempotencyKey: input.idempotencyKey,
      },
    });
    await tx.paymentTransaction.create({
      data: {
        paymentId: created.id,
        provider: input.method,
        providerReference: result.success ? result.providerReference : undefined,
        event: result.success ? 'CAPTURED' : 'FAILED',
        amount: input.amount,
        rawPayload: result.success ? undefined : { failureReason: result.failureReason },
      },
    });
    return created;
  });

  if (!result.success) {
    return fail('PAYMENT_FAILED', result.failureReason ?? 'Payment failed. Please try again or use a different method.');
  }
  return ok(toPaymentDto(payment));
}
