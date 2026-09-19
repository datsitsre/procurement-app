import 'server-only';
import type { PaymentMethod } from '@/types/orders';

export interface PaymentChargeRequest {
  amount: number;
  currency: string;
  reference: string;
  /** Method-specific details - a card number, a mobile money phone number, a bank reference,
   *  etc. Shaped loosely on purpose: each provider only reads the fields it needs, and a real
   *  provider integration would define its own stricter request type without touching this
   *  interface or any caller of it. */
  details: Record<string, string>;
}

/**
 * `status` has three outcomes, not two, because a real gateway call is not always resolved by
 * the time this function returns:
 * - SUCCEEDED  - money has moved (or, for CREDIT_TERMS, the credit line is reserved) right now.
 * - FAILED     - the gateway rejected the request outright (bad card, insufficient funds, ...).
 * - PENDING    - the gateway *accepted* the request but settlement is asynchronous (this is the
 *   normal case for mobile money "request to pay": the customer still has to approve a prompt on
 *   their phone, which can take anywhere from seconds to minutes, or never happen at all). A
 *   PENDING charge is not a failure and not a success - it becomes one or the other later, via
 *   POST /api/webhooks/payments/[provider] (webhook.service.ts) once the gateway calls back.
 *   Every mock provider in providers.ts still only ever returns SUCCEEDED/FAILED synchronously;
 *   PENDING is exercised for real by the mobile-money gateway providers in gateways/*.ts.
 */
export interface PaymentChargeResult {
  status: 'SUCCEEDED' | 'FAILED' | 'PENDING';
  /** The gateway's own reference for this attempt when one exists (SUCCEEDED/PENDING). Callers
   *  key later webhook lookups off this, via Payment.reference - see payment.service.ts. */
  providerReference: string;
  failureReason?: string;
}

/**
 * The abstraction every payment method (section 26) implements, server-side (Phase 14, Stage 8;
 * ported unchanged from the client mock's own PaymentProvider). Nothing in payment.service.ts or
 * the checkout route knows or cares which concrete provider is behind a given `PaymentMethod` -
 * swapping this mock for a real gateway (Paystack, Flutterwave, a direct MoMo API integration,
 * etc.) means writing one new class here, not touching business logic.
 */
export interface PaymentProvider {
  readonly method: PaymentMethod;
  charge(request: PaymentChargeRequest): Promise<PaymentChargeResult>;
}
