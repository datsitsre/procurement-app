import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { enforceRateLimit } from '@/server/auth/rate-limit';
import { runDueSchedules } from '@/server/services/recurringPurchase.service';
import { withErrorHandling } from '@/server/errors';

/** The "Run due schedules now" button's real destination - authenticated, company-scoped, and
 *  running the exact same server-side sweep the real cron route calls (see
 *  /api/cron/recurring-purchase-sweep), scoped to just this company so it can't be used to
 *  trigger every other company's schedules too. The browser only ever asks the server to do
 *  this; it never computes or writes the result itself (section 19/33). */
export const POST = withErrorHandling("/api/companies/[companyId]/recurring-purchases/run-due", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/recurring-purchases/run-due'>) => {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.PURCHASE_REQUEST_CREATE);
  if (!access.ok) return access.response;

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const limited = enforceRateLimit('procurementWrite', `${access.auth.userId}:${ip}`);
  if (limited) return limited;

  const result = await runDueSchedules({ companyId });
  return NextResponse.json(result);
});
