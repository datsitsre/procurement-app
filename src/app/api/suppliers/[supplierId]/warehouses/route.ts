import { NextResponse, type NextRequest } from 'next/server';
import { requireSupplierAccess } from '@/server/auth/require';
import { listWarehousesForSupplier } from '@/server/services/catalog.service';
import { withErrorHandling } from '@/server/errors';

export const GET = withErrorHandling("/api/suppliers/[supplierId]/warehouses", async (request: NextRequest, ctx: RouteContext<'/api/suppliers/[supplierId]/warehouses'>) => {
  const { supplierId } = await ctx.params;
  const access = await requireSupplierAccess(request, supplierId);
  if (!access.ok) return access.response;

  const result = await listWarehousesForSupplier(supplierId);
  return NextResponse.json(result.ok ? result.data : []);
});
