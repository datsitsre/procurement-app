import { NextResponse, type NextRequest } from 'next/server';
import { requireCronSecret } from '@/server/auth/require';
import { runDueSchedules } from '@/server/services/recurringPurchase.service';
import { withErrorHandling } from '@/server/errors';

/** Meant to be hit on a schedule (Vercel Cron, a GitHub Actions cron job, system crontab + curl,
 *  ...) - see requireCronSecret's own comment for how this is authenticated instead of a
 *  session. Sweeps every company's due schedules in one call (no `scope`), the same shape as
 *  the other cron sweeps in this app (invoiceDueSweep, lowStockSweep, pendingPaymentSweep). */
export const POST = withErrorHandling("/api/cron/recurring-purchase-sweep", async (request: NextRequest) => {
  const access = await requireCronSecret(request);
  if (!access.ok) return access.response;

  const result = await runDueSchedules();
  return NextResponse.json(result);
});

// Vercel Cron always invokes the configured path with GET, never POST (Phase 23) - the same
// handler, not a duplicate, so GitHub Actions/crontab's own POST calls keep working unchanged.
export const GET = POST;
