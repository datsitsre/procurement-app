import { NextResponse, type NextRequest } from 'next/server';
import { requireSupplierAccess } from '@/server/auth/require';
import { listDisputesForSupplier } from '@/server/services/disputes.service';

export async function GET(request: NextRequest, ctx: RouteContext<'/api/suppliers/[supplierId]/disputes'>) {
  const { supplierId } = await ctx.params;
  const access = await requireSupplierAccess(request, supplierId);
  if (!access.ok) return access.response;

  const result = await listDisputesForSupplier(supplierId);
  return NextResponse.json(result.ok ? result.data : []);
}
