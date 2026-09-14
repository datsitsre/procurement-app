import 'server-only';
import { db } from '@/server/db';
import { env } from '@/server/env';
import { processPaymentWebhook } from '@/server/services/webhook.service';
import { MomoGatewayClient } from '@/server/services/payment/gateways/momoGatewayClient';
import type { MobileMoneyGatewayEnv } from '@/server/env';
import type { PaymentMethod } from '@/types/orders';

const MOBILE_MONEY_GATEWAY_ENV: Record<'MTN_MOMO' | 'TELECEL_CASH' | 'AIRTELTIGO_MONEY', MobileMoneyGatewayEnv | null> = {
  MTN_MOMO: env.MTN_MOMO,
  TELECEL_CASH: env.TELECEL_CASH,
  AIRTELTIGO_MONEY: env.AIRTELTIGO_MONEY,
};

/**
 * Reconciles mobile money Payments still sitting PENDING because a webhook callback never
 * arrived - MTN's own sandbox is documented as not reliably sending one, and there's no reason
 * to assume every deployment's webhook config is flawless either. Polls each pending payment's
 * gateway for its real current status and, once it's no longer PENDING, runs it through the
 * exact same processPaymentWebhook (webhook.service.ts) an inbound webhook would - so a payment
 * resolved this way gets the identical invoice/order cascade as one resolved by a real callback,
 * with no separate settlement path to keep in sync.
 *
 * Meant to run on a schedule (POST /api/cron/pending-payment-sweep), a few minutes apart - a
 * mobile money approval prompt can take anywhere from seconds to minutes for a customer to act
 * on, so this isn't meant to catch a payment the instant it settles, just to guarantee eventual
 * consistency for the ones whose webhook never came.
 *
 * `scope.companyId` is test-only plumbing - the real cron route never passes it, so production
 * always sweeps every company. It exists so this file's own regression suite can point a real
 * sweep at just its own scratch payment without also racing every other test file's concurrently-
 * running PENDING mobile money fixtures in the same shared database (the equivalent global-scan
 * collision jobs/invoiceDueSweep.ts's tests hit, worked around there by controlling `dueDate`
 * instead - not possible here since there's no per-row field to steer around, only company).
 */
export async function runPendingPaymentSweep(scope?: { companyId?: string }): Promise<{ resolved: number; stillPending: number }> {
  const pending = await db.payment.findMany({
    where: {
      status: 'PENDING',
      method: { in: ['MTN_MOMO', 'TELECEL_CASH', 'AIRTELTIGO_MONEY'] satisfies PaymentMethod[] },
      ...(scope?.companyId ? { companyId: scope.companyId } : {}),
    },
  });

  let resolved = 0;
  let stillPending = 0;

  for (const payment of pending) {
    const gatewayConfig = MOBILE_MONEY_GATEWAY_ENV[payment.method as 'MTN_MOMO' | 'TELECEL_CASH' | 'AIRTELTIGO_MONEY'];
    if (!gatewayConfig) {
      // No real gateway configured for this network - this Payment can only have reached PENDING
      // via the local simulation, which never returns PENDING (see mobileMoneyProvider.ts's
      // fallback). In practice unreachable, but skip rather than poll nothing.
      stillPending += 1;
      continue;
    }

    let status: 'PENDING' | 'SUCCESSFUL' | 'FAILED';
    try {
      status = await new MomoGatewayClient(gatewayConfig).getStatus(payment.reference);
    } catch {
      stillPending += 1;
      continue; // transient network/auth failure - retried on the next scheduled run
    }

    if (status === 'PENDING') {
      stillPending += 1;
      continue;
    }

    const result = await processPaymentWebhook({
      providerReference: payment.reference,
      event: status === 'SUCCESSFUL' ? 'payment.captured' : 'payment.failed',
    });
    if (result.ok && result.data.changed) resolved += 1;
  }

  return { resolved, stillPending };
}
