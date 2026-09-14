import { NextResponse, type NextRequest } from 'next/server';
import { requireCronSecret } from '@/server/auth/require';
import { runLowStockSweep } from '@/server/services/jobs/lowStockSweep';

/** Meant to be hit on a schedule - see invoice-due-sweep's own comment and
 *  requireCronSecret's for the authentication/concurrency notes, both equally true here. */
export async function POST(request: NextRequest) {
  const access = await requireCronSecret(request);
  if (!access.ok) return access.response;

  const result = await runLowStockSweep();
  return NextResponse.json(result);
}
