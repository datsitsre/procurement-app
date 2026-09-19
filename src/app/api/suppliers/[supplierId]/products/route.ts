import { NextResponse, type NextRequest } from 'next/server';
import { requireSupplierAccess } from '@/server/auth/require';
import { listProductsForSupplier } from '@/server/services/catalog.service';
import { withErrorHandling } from '@/server/errors';

/** A supplier's own listing, for the Products & Inventory page (section 34) - unfiltered by
 *  moderation status, unlike the buyer-facing /api/products. */
export const GET = withErrorHandling("/api/suppliers/[supplierId]/products", async (request: NextRequest, ctx: RouteContext<'/api/suppliers/[supplierId]/products'>) => {
  const { supplierId } = await ctx.params;
  const access = await requireSupplierAccess(request, supplierId);
  if (!access.ok) return access.response;

  const result = await listProductsForSupplier(supplierId);
  return NextResponse.json(result.ok ? result.data : []);
});
