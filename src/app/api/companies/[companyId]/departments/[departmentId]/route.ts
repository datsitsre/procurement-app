import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { removeDepartment } from '@/server/services/company.service';

export async function DELETE(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/departments/[departmentId]'>) {
  const { companyId, departmentId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.SETTINGS_MANAGE);
  if (!access.ok) return access.response;

  const result = await removeDepartment(companyId, departmentId);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });
  return NextResponse.json({ ok: true });
}
