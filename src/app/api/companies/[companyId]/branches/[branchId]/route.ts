import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { removeBranch } from '@/server/services/company.service';

export async function DELETE(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/branches/[branchId]'>) {
  const { companyId, branchId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.SETTINGS_MANAGE);
  if (!access.ok) return access.response;

  const result = await removeBranch(companyId, branchId);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: result.error.code === 'INVALID_STATE' ? 409 : 404 });
  return NextResponse.json({ ok: true });
}
