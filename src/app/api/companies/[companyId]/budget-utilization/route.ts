import { NextResponse, type NextRequest } from 'next/server';
import { requireCompanyAccess } from '@/server/auth/require';
import { listUtilization } from '@/server/services/budget.service';
import { withErrorHandling } from '@/server/errors';

export const GET = withErrorHandling("/api/companies/[companyId]/budget-utilization", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/budget-utilization'>) => {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const result = await listUtilization(companyId);
  return NextResponse.json(result.ok ? result.data : []);
});
