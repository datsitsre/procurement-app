import { NextResponse, type NextRequest } from 'next/server';
import { requireSupplierAccess } from '@/server/auth/require';
import { listPaymentsForSupplier } from '@/server/services/payment.service';

export async function GET(request: NextRequest, ctx: RouteContext<'/api/suppliers/[supplierId]/payments'>) {
  const { supplierId } = await ctx.params;
  const access = await requireSupplierAccess(request, supplierId);
  if (!access.ok) return access.response;

  const result = await listPaymentsForSupplier(supplierId);
  return NextResponse.json(result.ok ? result.data : []);
}
