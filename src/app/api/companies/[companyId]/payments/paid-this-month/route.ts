import { NextResponse, type NextRequest } from 'next/server';
import { requireCompanyAccess } from '@/server/auth/require';
import { getPaidThisMonthTotal } from '@/server/services/payment.service';
import { withErrorHandling } from '@/server/errors';

/** Real database aggregation (Phase 19) - replaces the finance dashboard's own client-side
 *  `.filter().reduce()` over the *entire* payment history, which broke once that list became
 *  paginated (a payment made earlier this month could land on any page). */
export const GET = withErrorHandling(
  '/api/companies/[companyId]/payments/paid-this-month',
  async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/payments/paid-this-month'>) => {
    const { companyId } = await ctx.params;
    const access = await requireCompanyAccess(request, companyId);
    if (!access.ok) return access.response;

    const result = await getPaidThisMonthTotal(companyId);
    return NextResponse.json({ amount: result.ok ? result.data : 0 });
  },
);
