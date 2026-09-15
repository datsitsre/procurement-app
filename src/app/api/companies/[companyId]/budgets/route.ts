import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { createBudget, listBudgets } from '@/server/services/budget.service';
import { NewBudgetSchema } from '@/server/validation/procurement-backend';

export async function GET(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/budgets'>) {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const result = await listBudgets(companyId);
  return NextResponse.json(result.ok ? result.data : []);
}

export async function POST(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/budgets'>) {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.SETTINGS_MANAGE);
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  const parsed = NewBudgetSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });

  const result = await createBudget({ companyId, ...parsed.data }, { id: access.auth.userId, name: access.auth.userName });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
}
