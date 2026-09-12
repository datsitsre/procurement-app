import { delay, fail, ok } from './base';
import { paymentProviders } from './payment/providers';
import type { ServiceResult, UUID } from '@/types/common';
import type { CreditTerm } from '@/types/company';
import type { Payment, PaymentMethod } from '@/types/orders';

const PAYMENT_STORE_KEY = 'procurement.payments.v1.list';

function newId(prefix: string): UUID {
  return `${prefix}-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()}`;
}

function readPayments(): Payment[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(PAYMENT_STORE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Payment[];
  } catch {
    return [];
  }
}

function appendPayment(payment: Payment) {
  if (typeof window === 'undefined') return;
  const list = readPayments();
  list.push(payment);
  window.localStorage.setItem(PAYMENT_STORE_KEY, JSON.stringify(list));
}

export interface ChargeInput {
  companyId: UUID;
  amount: number;
  currency: string;
  method: PaymentMethod;
  details: Record<string, string>;
  invoiceId?: UUID;
  orderId?: UUID;
}

export interface PaymentService {
  listPayments(companyId: UUID): Promise<ServiceResult<Payment[]>>;
  charge(input: ChargeInput): Promise<ServiceResult<Payment>>;
}

class MockPaymentService implements PaymentService {
  async listPayments(companyId: UUID): Promise<ServiceResult<Payment[]>> {
    await delay(200);
    return ok(readPayments().filter((p) => p.companyId === companyId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)));
  }

  async charge(input: ChargeInput): Promise<ServiceResult<Payment>> {
    const provider = paymentProviders[input.method];
    if (!provider) return fail('UNSUPPORTED_METHOD', `No payment provider is configured for ${input.method}.`);

    const reference = `pay-${Date.now()}`;
    const result = await provider.charge({
      amount: input.amount,
      currency: input.currency,
      reference,
      details: input.details,
    });

    const payment: Payment = {
      id: newId('payment'),
      companyId: input.companyId,
      invoiceId: input.invoiceId,
      orderId: input.orderId,
      amount: input.amount,
      method: input.method,
      status: result.success ? 'PAID' : 'FAILED',
      reference: result.success ? result.providerReference : reference,
      createdAt: new Date().toISOString(),
    };
    appendPayment(payment);

    if (!result.success) {
      return fail('PAYMENT_FAILED', result.failureReason ?? 'Payment failed. Please try again or use a different method.');
    }
    return ok(payment);
  }
}

export const paymentService: PaymentService = new MockPaymentService();

/** How many days out an invoice is due for a given credit term - Net 30 -> 30 days, etc. */
export function dueDaysFor(term: CreditTerm): number {
  switch (term) {
    case 'NET_7':
      return 7;
    case 'NET_15':
      return 15;
    case 'NET_30':
      return 30;
    case 'NET_60':
      return 60;
    case 'PREPAID':
    default:
      return 0;
  }
}
