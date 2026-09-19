import { NextResponse, type NextRequest } from 'next/server';
import { requireSupplierAccess } from '@/server/auth/require';
import { getSupplierAnalytics } from '@/server/services/analytics.service';
import { withErrorHandling } from '@/server/errors';

export const GET = withErrorHandling("/api/suppliers/[supplierId]/analytics", async (request: NextRequest, ctx: RouteContext<'/api/suppliers/[supplierId]/analytics'>) => {
  const { supplierId } = await ctx.params;
  const access = await requireSupplierAccess(request, supplierId);
  if (!access.ok) return access.response;

  const result = await getSupplierAnalytics(supplierId);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 500 });
  return NextResponse.json(result.data);
});
