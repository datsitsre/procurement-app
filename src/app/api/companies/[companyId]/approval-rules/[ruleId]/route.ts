import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { removeApprovalRule } from '@/server/services/procurement.service';

export async function DELETE(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/approval-rules/[ruleId]'>) {
  const { companyId, ruleId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.SETTINGS_MANAGE);
  if (!access.ok) return access.response;

  const result = await removeApprovalRule(companyId, ruleId);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });
  return NextResponse.json({ ok: true });
}
