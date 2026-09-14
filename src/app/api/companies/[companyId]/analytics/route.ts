import { NextResponse, type NextRequest } from 'next/server';
import { requireCompanyAccess } from '@/server/auth/require';
import { getBuyerAnalytics } from '@/server/services/analytics.service';

export async function GET(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/analytics'>) {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const result = await getBuyerAnalytics(companyId);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 500 });
  return NextResponse.json(result.data);
}
