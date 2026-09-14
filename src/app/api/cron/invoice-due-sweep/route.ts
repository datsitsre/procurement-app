import { NextResponse, type NextRequest } from 'next/server';
import { requireCronSecret } from '@/server/auth/require';
import { runInvoiceDueSweep } from '@/server/services/jobs/invoiceDueSweep';

/** Meant to be hit on a schedule (Vercel Cron, a GitHub Actions cron job, system crontab + curl,
 *  ...) - see requireCronSecret's own comment for how this is authenticated instead of a
 *  session. Not idempotent in the sense of "safe to call concurrently with itself" (two
 *  overlapping runs could both see the same PENDING invoice before either updates it), but
 *  every real deployment schedules this at a sane interval (hourly/daily), never a concurrency
 *  this app needs to guard against today. */
export async function POST(request: NextRequest) {
  const access = await requireCronSecret(request);
  if (!access.ok) return access.response;

  const result = await runInvoiceDueSweep();
  return NextResponse.json(result);
}
