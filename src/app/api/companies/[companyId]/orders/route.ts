import { NextResponse, type NextRequest } from 'next/server';
import { requireCompanyAccess } from '@/server/auth/require';
import { listOrders } from '@/server/services/orders.service';

export async function GET(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/orders'>) {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const result = await listOrders(companyId);
  return NextResponse.json(result.ok ? result.data : []);
}
