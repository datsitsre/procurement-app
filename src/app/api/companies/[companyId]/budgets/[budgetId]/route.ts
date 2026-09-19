import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { enforceRateLimit } from '@/server/auth/rate-limit';
import { removeBudget } from '@/server/services/budget.service';
import { withErrorHandling } from '@/server/errors';

export const DELETE = withErrorHandling("/api/companies/[companyId]/budgets/[budgetId]", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/budgets/[budgetId]'>) => {
  const { companyId, budgetId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.SETTINGS_MANAGE);
  if (!access.ok) return access.response;

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const limited = enforceRateLimit('procurementWrite', `${access.auth.userId}:${ip}`);
  if (limited) return limited;

  const result = await removeBudget(budgetId, companyId, { id: access.auth.userId, name: access.auth.userName });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });
  return NextResponse.json({ ok: true });
});
