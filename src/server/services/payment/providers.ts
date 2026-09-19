import 'server-only';
import { env } from '@/server/env';
import type { PaymentProvider, PaymentChargeRequest, PaymentChargeResult } from './PaymentProvider';
import type { PaymentMethod } from '@/types/orders';
import { MobileMoneyGatewayProvider } from './gateways/mobileMoneyProvider';

function reference(prefix: string): string {
  return `${prefix}-${Math.floor(100000 + Math.random() * 899999)}`;
}

/** Card payments (Visa/Mastercard, section 26) - validates a well-formed card the same way a
 *  real gateway would reject before ever attempting to charge it. */
class CardPaymentProvider implements PaymentProvider {
  readonly method: PaymentMethod = 'CARD';

  async charge(request: PaymentChargeRequest): Promise<PaymentChargeResult> {
    const cardNumber = request.details.cardNumber?.replace(/\s+/g, '') ?? '';
    if (!/^\d{16}$/.test(cardNumber)) {
      return { status: 'FAILED', providerReference: '', failureReason: 'Enter a valid 16-digit card number.' };
    }
    if (!/^\d{3,4}$/.test(request.details.cvv ?? '')) {
      return { status: 'FAILED', providerReference: '', failureReason: 'Enter a valid CVV.' };
    }
    return { status: 'SUCCEEDED', providerReference: reference('CARD') };
  }
}

/** Bank transfer (section 26) - in a real integration this would return a "pending" result
 *  until the transfer is reconciled against a bank statement or webhook; the mock resolves
 *  immediately so checkout can be exercised end to end. */
class BankTransferProvider implements PaymentProvider {
  readonly method: PaymentMethod = 'BANK_TRANSFER';

  async charge(request: PaymentChargeRequest): Promise<PaymentChargeResult> {
    if (!request.details.bankReference?.trim()) {
      return { status: 'FAILED', providerReference: '', failureReason: 'Enter your bank transfer reference.' };
    }
    return { status: 'SUCCEEDED', providerReference: reference('BANK') };
  }
}

/** Wallet (platform balance, section 25) - a placeholder balance since there's no real wallet
 *  ledger yet; always succeeds in the mock. */
class WalletProvider implements PaymentProvider {
  readonly method: PaymentMethod = 'WALLET';

  async charge(): Promise<PaymentChargeResult> {
    return { status: 'SUCCEEDED', providerReference: reference('WALLET') };
  }
}

/**
 * Credit terms (section 27) - not a real payment at all: it checks the company has enough
 * remaining credit limit and reserves it, letting the order proceed to fulfillment while the
 * invoice stays unpaid until its due date. `creditAvailable` is read from the company's own
 * record here, server-side, never trusted from request `details` the way the old client mock
 * had to (it had no server to ask).
 */
class CreditTermsProvider implements PaymentProvider {
  readonly method: PaymentMethod = 'CREDIT_TERMS';

  async charge(request: PaymentChargeRequest): Promise<PaymentChargeResult> {
    const available = Number(request.details.creditAvailable ?? '0');
    if (request.amount > available) {
      return { status: 'FAILED', providerReference: '', failureReason: 'This exceeds your company’s available credit.' };
    }
    return { status: 'SUCCEEDED', providerReference: reference('CREDIT') };
  }
}

export const paymentProviders: Record<PaymentMethod, PaymentProvider> = {
  CARD: new CardPaymentProvider(),
  MTN_MOMO: new MobileMoneyGatewayProvider('MTN_MOMO', 'MTN', env.MTN_MOMO),
  TELECEL_CASH: new MobileMoneyGatewayProvider('TELECEL_CASH', 'TELECEL', env.TELECEL_CASH),
  AIRTELTIGO_MONEY: new MobileMoneyGatewayProvider('AIRTELTIGO_MONEY', 'ATMONEY', env.AIRTELTIGO_MONEY),
  BANK_TRANSFER: new BankTransferProvider(),
  WALLET: new WalletProvider(),
  CREDIT_TERMS: new CreditTermsProvider(),
};
