import { NextResponse, type NextRequest } from 'next/server';
import { requireSupplierAccess } from '@/server/auth/require';
import { getSupplierOrdersToFulfillCount } from '@/server/services/orders.service';
import { withErrorHandling } from '@/server/errors';

/** Supplier-dashboard stat, computed via a real database count (Phase 16) - replaces a
 *  client-side `.filter().length` over the entire unpaginated order list. */
export const GET = withErrorHandling("/api/suppliers/[supplierId]/orders/to-fulfill-count", async (request: NextRequest, ctx: RouteContext<'/api/suppliers/[supplierId]/orders/to-fulfill-count'>) => {
  const { supplierId } = await ctx.params;
  const access = await requireSupplierAccess(request, supplierId);
  if (!access.ok) return access.response;

  const result = await getSupplierOrdersToFulfillCount(supplierId);
  return NextResponse.json({ count: result.ok ? result.data : 0 });
});
