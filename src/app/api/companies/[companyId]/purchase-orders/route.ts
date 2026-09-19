import { NextResponse, type NextRequest } from 'next/server';
import { requireCompanyAccess } from '@/server/auth/require';
import { listPurchaseOrders } from '@/server/services/purchase-order.service';
import { withErrorHandling } from '@/server/errors';

export const GET = withErrorHandling("/api/companies/[companyId]/purchase-orders", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/purchase-orders'>) => {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const result = await listPurchaseOrders(companyId);
  return NextResponse.json(result.ok ? result.data : []);
});
