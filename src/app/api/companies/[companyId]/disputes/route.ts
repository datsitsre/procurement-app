import { NextResponse, type NextRequest } from 'next/server';
import { requireCompanyAccess } from '@/server/auth/require';
import { listDisputes } from '@/server/services/disputes.service';

export async function GET(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/disputes'>) {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const result = await listDisputes(companyId);
  return NextResponse.json(result.ok ? result.data : []);
}
