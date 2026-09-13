import { NextResponse, type NextRequest } from 'next/server';
import { requireSupplierAccess } from '@/server/auth/require';
import { listRfqsForSupplier } from '@/server/services/procurement.service';

/** RFQs a supplier has been invited to, for the supplier-side RFQ inbox. */
export async function GET(request: NextRequest, ctx: RouteContext<'/api/suppliers/[supplierId]/rfqs'>) {
  const { supplierId } = await ctx.params;
  const access = await requireSupplierAccess(request, supplierId);
  if (!access.ok) return access.response;

  const result = await listRfqsForSupplier(supplierId);
  return NextResponse.json(result.ok ? result.data : []);
}
