import { NextResponse, type NextRequest } from 'next/server';
import { requireCronSecret } from '@/server/auth/require';
import { runPendingPaymentSweep } from '@/server/services/jobs/pendingPaymentSweep';
import { withErrorHandling } from '@/server/errors';

/** Meant to be hit on a schedule - see invoice-due-sweep's own comment and requireCronSecret's
 *  for the authentication notes, both equally true here. Unlike the other two sweeps, this one
 *  only does anything once a real mobile money gateway is configured (see env.ts's MTN_MOMO/
 *  TELECEL_CASH/AIRTELTIGO_MONEY) - it always returns 200 either way. */
export const POST = withErrorHandling("/api/cron/pending-payment-sweep", async (request: NextRequest) => {
  const access = await requireCronSecret(request);
  if (!access.ok) return access.response;

  const result = await runPendingPaymentSweep();
  return NextResponse.json(result);
});

// Vercel Cron always invokes the configured path with GET, never POST (Phase 23) - the same
// handler, not a duplicate, so GitHub Actions/crontab's own POST calls keep working unchanged.
export const GET = POST;
