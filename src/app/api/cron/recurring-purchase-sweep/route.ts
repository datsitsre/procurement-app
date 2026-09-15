import { NextResponse, type NextRequest } from 'next/server';
import { requireCronSecret } from '@/server/auth/require';
import { runDueSchedules } from '@/server/services/recurringPurchase.service';

/** Meant to be hit on a schedule (Vercel Cron, a GitHub Actions cron job, system crontab + curl,
 *  ...) - see requireCronSecret's own comment for how this is authenticated instead of a
 *  session. Sweeps every company's due schedules in one call (no `scope`), the same shape as
 *  the other cron sweeps in this app (invoiceDueSweep, lowStockSweep, pendingPaymentSweep). */
export async function POST(request: NextRequest) {
  const access = await requireCronSecret(request);
  if (!access.ok) return access.response;

  const result = await runDueSchedules();
  return NextResponse.json(result);
}
