import 'server-only';
import type { PaymentProvider, PaymentChargeRequest, PaymentChargeResult } from '../PaymentProvider';
import type { PaymentMethod } from '@/types/orders';
import { MomoGatewayClient, type MomoGatewayConfig } from './momoGatewayClient';

function reference(prefix: string): string {
  return `${prefix}-${Math.floor(100000 + Math.random() * 899999)}`;
}

/** Ghana MSISDN in the 233-country-code format the gateway expects, from the 0XXXXXXXXX shape
 *  the checkout form collects. */
function toMsisdn(localPhone: string): string {
  return `233${localPhone.replace(/^0/, '')}`;
}

/**
 * One of Ghana's three mobile money networks (MTN MoMo, Telecel Cash, AirtelTigo Money -
 * section 26/56), wired to a real gateway when one is configured. Real settlement is
 * asynchronous - `charge()` returns PENDING once the gateway has accepted the request, not
 * SUCCEEDED - the customer still has to approve a prompt on their phone. See
 * PaymentProvider.ts's own comment on `PaymentChargeResult.status` for why that's a third
 * outcome and not just success/failure, and jobs/pendingPaymentSweep.ts + webhook.service.ts for
 * how a PENDING payment eventually resolves.
 *
 * `client` is null whenever this network's env vars (`<PREFIX>_SUBSCRIPTION_KEY`/`_API_USER`/
 * `_API_KEY` - see env.ts) aren't set, which is true for every network out of the box - nothing
 * in this repo ships real mobile money credentials. In that case `charge()` falls back to the
 * same instant-success simulation the old mock provider used, so the app (demo data, the whole
 * existing test suite, anyone cloning this repo without a merchant agreement) keeps working
 * exactly as it did before this file existed. Configuring real credentials is the only thing
 * that turns on the real HTTP flow - business logic callers (payment.service.ts) don't need to
 * know or care which mode a given deployment is running in.
 */
export class MobileMoneyGatewayProvider implements PaymentProvider {
  constructor(
    public readonly method: Extract<PaymentMethod, 'MTN_MOMO' | 'TELECEL_CASH' | 'AIRTELTIGO_MONEY'>,
    private readonly networkLabel: string,
    private readonly gatewayConfig: MomoGatewayConfig | null,
  ) {}

  async charge(request: PaymentChargeRequest): Promise<PaymentChargeResult> {
    const phone = request.details.phone?.replace(/\s+/g, '') ?? '';
    if (!/^0\d{9}$/.test(phone)) {
      return { status: 'FAILED', providerReference: '', failureReason: 'Enter a valid 10-digit mobile money number (starting with 0).' };
    }

    if (!this.gatewayConfig) {
      return { status: 'SUCCEEDED', providerReference: reference(this.networkLabel) };
    }

    const client = new MomoGatewayClient(this.gatewayConfig);
    try {
      const result = await client.requestToPay({
        amount: request.amount,
        currency: request.currency,
        phone: toMsisdn(phone),
        externalId: request.reference,
        payerMessage: `Payment ${request.reference}`,
        payeeNote: `Payment ${request.reference}`,
      });
      if (result.outcome === 'REJECTED') {
        return { status: 'FAILED', providerReference: '', failureReason: result.reason };
      }
      return { status: 'PENDING', providerReference: result.referenceId };
    } catch {
      // Transport/auth failure - the request was never actually attempted. Fail closed rather
      // than silently falling back to the mock, so a misconfigured deployment surfaces loudly
      // instead of quietly pretending every charge succeeded.
      return { status: 'FAILED', providerReference: '', failureReason: 'Could not reach the mobile money gateway. Please try again.' };
    }
  }
}
