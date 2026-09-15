import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { removeBudget } from '@/server/services/budget.service';

export async function DELETE(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/budgets/[budgetId]'>) {
  const { companyId, budgetId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.SETTINGS_MANAGE);
  if (!access.ok) return access.response;

  const result = await removeBudget(budgetId, companyId, { id: access.auth.userId, name: access.auth.userName });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });
  return NextResponse.json({ ok: true });
}
