import { NextResponse, type NextRequest } from 'next/server';
import { requireCompanyAccess } from '@/server/auth/require';
import { getOrderSummary } from '@/server/services/orders.service';
import { withErrorHandling } from '@/server/errors';

/** Dashboard totals (total/monthly spend, open order count) computed via real database
 *  aggregation (Phase 16) - replaces the dashboard's previous client-side `.reduce()` over the
 *  entire unpaginated order list, which broke once `listOrders` itself was paginated. */
export const GET = withErrorHandling("/api/companies/[companyId]/orders/summary", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/orders/summary'>) => {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const result = await getOrderSummary(companyId);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
});
