import { NextResponse, type NextRequest } from 'next/server';
import { requireCompanyAccess } from '@/server/auth/require';
import { listSpendingLimits } from '@/server/services/company.service';
import { withErrorHandling } from '@/server/errors';

export const GET = withErrorHandling("/api/companies/[companyId]/spending-limits", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/spending-limits'>) => {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const result = await listSpendingLimits(companyId);
  return NextResponse.json(result.ok ? result.data : []);
});
