import { NextResponse, type NextRequest } from 'next/server';
import { requireSupplierAccess } from '@/server/auth/require';
import { listInvoicesForSupplier } from '@/server/services/invoices.service';

export async function GET(request: NextRequest, ctx: RouteContext<'/api/suppliers/[supplierId]/invoices'>) {
  const { supplierId } = await ctx.params;
  const access = await requireSupplierAccess(request, supplierId);
  if (!access.ok) return access.response;

  const result = await listInvoicesForSupplier(supplierId);
  return NextResponse.json(result.ok ? result.data : []);
}
