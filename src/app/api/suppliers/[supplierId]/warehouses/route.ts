import { NextResponse, type NextRequest } from 'next/server';
import { requireSupplierAccess } from '@/server/auth/require';
import { listWarehousesForSupplier } from '@/server/services/catalog.service';

export async function GET(request: NextRequest, ctx: RouteContext<'/api/suppliers/[supplierId]/warehouses'>) {
  const { supplierId } = await ctx.params;
  const access = await requireSupplierAccess(request, supplierId);
  if (!access.ok) return access.response;

  const result = await listWarehousesForSupplier(supplierId);
  return NextResponse.json(result.ok ? result.data : []);
}
