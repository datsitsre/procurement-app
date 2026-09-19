import { Banknote, CreditCard, Smartphone, Wallet } from 'lucide-react';
import type { PaymentMethod } from '@/types/orders';

export interface PaymentMethodConfig {
  label: string;
  description: string;
  icon: typeof CreditCard;
}

/** Display metadata for every payment method (section 26/56) - one place both the checkout
 *  flow and the invoice "Pay" dialog read from, so a method reads identically wherever it's
 *  offered. CREDIT_TERMS is deliberately excluded here - it's only offered when a company's
 *  credit terms allow it, gated separately in the checkout/pay UI. */
export const PaymentMethodConfigs: Record<PaymentMethod, PaymentMethodConfig> = {
  CARD: { label: 'Card', description: 'Visa or Mastercard', icon: CreditCard },
  MTN_MOMO: { label: 'MTN Mobile Money', description: 'Pay from your MTN MoMo wallet', icon: Smartphone },
  TELECEL_CASH: { label: 'Telecel Cash', description: 'Pay from your Telecel Cash wallet', icon: Smartphone },
  AIRTELTIGO_MONEY: { label: 'AirtelTigo Money', description: 'Pay from your AirtelTigo Money wallet', icon: Smartphone },
  BANK_TRANSFER: { label: 'Bank transfer', description: 'Pay by direct bank transfer', icon: Banknote },
  WALLET: { label: 'Platform wallet', description: 'Pay from your company wallet balance', icon: Wallet },
  CREDIT_TERMS: { label: 'Credit terms', description: 'Bill to your company’s approved credit line', icon: Banknote },
};

export const CreditTermLabels: Record<string, string> = {
  PREPAID: 'Prepaid',
  NET_7: 'Net 7',
  NET_15: 'Net 15',
  NET_30: 'Net 30',
  NET_60: 'Net 60',
};
