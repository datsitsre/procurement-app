import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { listTeamMembers } from '@/server/services/company.service';

export async function GET(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/team'>) {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.USERS_MANAGE);
  if (!access.ok) return access.response;

  const result = await listTeamMembers(companyId);
  return NextResponse.json(result.ok ? result.data : []);
}
