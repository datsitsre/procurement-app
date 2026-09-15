import { NextResponse, type NextRequest } from 'next/server';
import { requireCompanyAccess } from '@/server/auth/require';
import { listUtilization } from '@/server/services/budget.service';

export async function GET(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/budget-utilization'>) {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const result = await listUtilization(companyId);
  return NextResponse.json(result.ok ? result.data : []);
}
