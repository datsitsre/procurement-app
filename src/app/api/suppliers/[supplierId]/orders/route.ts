import { NextResponse, type NextRequest } from 'next/server';
import { requireSupplierAccess } from '@/server/auth/require';
import { listOrdersForSupplier } from '@/server/services/orders.service';

/** Orders a supplier needs to fulfill (section 44) - the supplier-workspace counterpart to
 *  GET /api/companies/[companyId]/orders. */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/suppliers/[supplierId]/orders'>) {
  const { supplierId } = await ctx.params;
  const access = await requireSupplierAccess(request, supplierId);
  if (!access.ok) return access.response;

  const result = await listOrdersForSupplier(supplierId);
  return NextResponse.json(result.ok ? result.data : []);
}
