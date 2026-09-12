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

export interface PaymentChargeResult {
  success: boolean;
  providerReference: string;
  failureReason?: string;
}

/**
 * The abstraction every payment method (section 26) implements. Nothing in payment.service.ts
 * or the checkout flow knows or cares which concrete provider is behind a given
 * `PaymentMethod` - swapping a mock for a real gateway (Paystack, Flutterwave, a direct MoMo
 * API integration, etc.) means writing one new class here, not touching business logic.
 */
export interface PaymentProvider {
  readonly method: PaymentMethod;
  charge(request: PaymentChargeRequest): Promise<PaymentChargeResult>;
}
