import { NextResponse, type NextRequest } from 'next/server';
import { requireCompanyAccess } from '@/server/auth/require';
import { listPayments } from '@/server/services/payment.service';

export async function GET(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/payments'>) {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const result = await listPayments(companyId);
  return NextResponse.json(result.ok ? result.data : []);
}
