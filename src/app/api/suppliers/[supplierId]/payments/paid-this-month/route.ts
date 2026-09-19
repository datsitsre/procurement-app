import { NextResponse, type NextRequest } from 'next/server';
import { requireSupplierAccess } from '@/server/auth/require';
import { getPaidThisMonthTotalForSupplier } from '@/server/services/payment.service';
import { withErrorHandling } from '@/server/errors';

/** Real database aggregation (Phase 19) - replaces the supplier dashboard's own client-side
 *  `.filter().reduce()` over the *entire* payment history. */
export const GET = withErrorHandling(
  '/api/suppliers/[supplierId]/payments/paid-this-month',
  async (request: NextRequest, ctx: RouteContext<'/api/suppliers/[supplierId]/payments/paid-this-month'>) => {
    const { supplierId } = await ctx.params;
    const access = await requireSupplierAccess(request, supplierId);
    if (!access.ok) return access.response;

    const result = await getPaidThisMonthTotalForSupplier(supplierId);
    return NextResponse.json({ amount: result.ok ? result.data : 0 });
  },
);
