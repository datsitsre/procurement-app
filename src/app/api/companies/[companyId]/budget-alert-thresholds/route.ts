import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { getAlertThresholds, setAlertThresholds } from '@/server/services/budget.service';
import { SetBudgetAlertThresholdsSchema } from '@/server/validation/procurement-backend';

export async function GET(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/budget-alert-thresholds'>) {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const result = await getAlertThresholds(companyId);
  return NextResponse.json(result.ok ? result.data : []);
}

export async function PUT(request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/budget-alert-thresholds'>) {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.SETTINGS_MANAGE);
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  const parsed = SetBudgetAlertThresholdsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 422 });

  const result = await setAlertThresholds(companyId, parsed.data.thresholds, { id: access.auth.userId, name: access.auth.userName });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json({ ok: true });
}
