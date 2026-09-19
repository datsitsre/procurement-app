import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { enforceRateLimit } from '@/server/auth/rate-limit';
import { createBudget, listBudgets } from '@/server/services/budget.service';
import { NewBudgetSchema } from '@/server/validation/procurement-backend';
import { withErrorHandling } from '@/server/errors';

export const GET = withErrorHandling("/api/companies/[companyId]/budgets", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/budgets'>) => {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const { auditCrossCompanyRead } = await import('@/server/services/audit.service');
  await auditCrossCompanyRead(access.auth, 'Budget', companyId, companyId);

  const result = await listBudgets(companyId);
  return NextResponse.json(result.ok ? result.data : []);
});

export const POST = withErrorHandling("/api/companies/[companyId]/budgets", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/budgets'>) => {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.SETTINGS_MANAGE);
  if (!access.ok) return access.response;

  const ip = request.headers.get('x-forwarded-for') ?? 'unknown';
  const limited = enforceRateLimit('procurementWrite', `${access.auth.userId}:${ip}`);
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const parsed = NewBudgetSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });

  const result = await createBudget({ companyId, ...parsed.data }, { id: access.auth.userId, name: access.auth.userName });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
});
