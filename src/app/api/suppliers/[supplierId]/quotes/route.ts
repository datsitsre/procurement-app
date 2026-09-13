import { NextResponse, type NextRequest } from 'next/server';
import { requireSupplierAccess } from '@/server/auth/require';
import { listQuotesForSupplier } from '@/server/services/procurement.service';

/** A supplier's own submitted quotes, for the supplier-side quotes page. */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/suppliers/[supplierId]/quotes'>) {
  const { supplierId } = await ctx.params;
  const access = await requireSupplierAccess(request, supplierId);
  if (!access.ok) return access.response;

  const result = await listQuotesForSupplier(supplierId);
  return NextResponse.json(result.ok ? result.data : []);
}
