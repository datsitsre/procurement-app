import { delay } from '../base';
import type { PaymentProvider, PaymentChargeRequest, PaymentChargeResult } from './PaymentProvider';
import type { PaymentMethod } from '@/types/orders';

function reference(prefix: string): string {
  return `${prefix}-${Math.floor(100000 + Math.random() * 899999)}`;
}

/** Card payments (Visa/Mastercard, section 26) - validates a well-formed card the same way a
 *  real gateway would reject before ever attempting to charge it. */
class CardPaymentProvider implements PaymentProvider {
  readonly method: PaymentMethod = 'CARD';

  async charge(request: PaymentChargeRequest): Promise<PaymentChargeResult> {
    await delay(700);
    const cardNumber = request.details.cardNumber?.replace(/\s+/g, '') ?? '';
    if (!/^\d{16}$/.test(cardNumber)) {
      return { success: false, providerReference: '', failureReason: 'Enter a valid 16-digit card number.' };
    }
    if (!/^\d{3,4}$/.test(request.details.cvv ?? '')) {
      return { success: false, providerReference: '', failureReason: 'Enter a valid CVV.' };
    }
    return { success: true, providerReference: reference('CARD') };
  }
}

/** One provider class handles all three Ghanaian mobile money networks (section 26/56) -
 *  the network only changes the reference prefix and which wallet the (mock) debit hits;
 *  the validation and charge flow are identical. */
class MobileMoneyProvider implements PaymentProvider {
  constructor(public readonly method: 'MTN_MOMO' | 'TELECEL_CASH' | 'AIRTELTIGO_MONEY', private readonly networkLabel: string) {}

  async charge(request: PaymentChargeRequest): Promise<PaymentChargeResult> {
    await delay(900);
    const phone = request.details.phone?.replace(/\s+/g, '') ?? '';
    if (!/^0\d{9}$/.test(phone)) {
      return { success: false, providerReference: '', failureReason: 'Enter a valid 10-digit mobile money number (starting with 0).' };
    }
    return { success: true, providerReference: reference(this.networkLabel) };
  }
}

/** Bank transfer (section 26) - in a real integration this would return a "pending" result
 *  until the transfer is reconciled against a bank statement or webhook; the mock resolves
 *  immediately so the demo checkout flow can be exercised end to end. */
class BankTransferProvider implements PaymentProvider {
  readonly method: PaymentMethod = 'BANK_TRANSFER';

  async charge(request: PaymentChargeRequest): Promise<PaymentChargeResult> {
    await delay(600);
    if (!request.details.bankReference?.trim()) {
      return { success: false, providerReference: '', failureReason: 'Enter your bank transfer reference.' };
    }
    return { success: true, providerReference: reference('BANK') };
  }
}

/** Wallet (platform balance, section 25) - a placeholder balance since there's no real wallet
 *  ledger yet; always succeeds in the mock. */
class WalletProvider implements PaymentProvider {
  readonly method: PaymentMethod = 'WALLET';

  async charge(): Promise<PaymentChargeResult> {
    await delay(400);
    return { success: true, providerReference: reference('WALLET') };
  }
}

/**
 * Credit terms (section 27) - not a real payment at all: it checks the company has enough
 * remaining credit limit and reserves it, letting the order proceed to fulfillment while the
 * invoice stays unpaid until its due date. Only companies with approved credit terms can use
 * this - enforced by the checkout UI only offering it when `company.creditTerms !== 'PREPAID'`.
 */
class CreditTermsProvider implements PaymentProvider {
  readonly method: PaymentMethod = 'CREDIT_TERMS';

  async charge(request: PaymentChargeRequest): Promise<PaymentChargeResult> {
    await delay(500);
    const available = Number(request.details.creditAvailable ?? '0');
    if (request.amount > available) {
      return { success: false, providerReference: '', failureReason: 'This exceeds your company’s available credit.' };
    }
    return { success: true, providerReference: reference('CREDIT') };
  }
}

export const paymentProviders: Record<PaymentMethod, PaymentProvider> = {
  CARD: new CardPaymentProvider(),
  MTN_MOMO: new MobileMoneyProvider('MTN_MOMO', 'MTN'),
  TELECEL_CASH: new MobileMoneyProvider('TELECEL_CASH', 'TELECEL'),
  AIRTELTIGO_MONEY: new MobileMoneyProvider('AIRTELTIGO_MONEY', 'ATMONEY'),
  BANK_TRANSFER: new BankTransferProvider(),
  WALLET: new WalletProvider(),
  CREDIT_TERMS: new CreditTermsProvider(),
};
