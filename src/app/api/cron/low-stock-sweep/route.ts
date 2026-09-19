import { NextResponse, type NextRequest } from 'next/server';
import { requireCronSecret } from '@/server/auth/require';
import { runLowStockSweep } from '@/server/services/jobs/lowStockSweep';
import { withErrorHandling } from '@/server/errors';

/** Meant to be hit on a schedule - see invoice-due-sweep's own comment and
 *  requireCronSecret's for the authentication/concurrency notes, both equally true here. */
export const POST = withErrorHandling("/api/cron/low-stock-sweep", async (request: NextRequest) => {
  const access = await requireCronSecret(request);
  if (!access.ok) return access.response;

  const result = await runLowStockSweep();
  return NextResponse.json(result);
});

// Vercel Cron always invokes the configured path with GET, never POST (Phase 23) - the same
// handler, not a duplicate, so GitHub Actions/crontab's own POST calls keep working unchanged.
export const GET = POST;
