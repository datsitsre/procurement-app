import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { createCostCenter, listCostCenters } from '@/server/services/company.service';
import { NewCostCenterSchema } from '@/server/validation/company';
import { withErrorHandling } from '@/server/errors';

export const GET = withErrorHandling("/api/companies/[companyId]/cost-centers", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/cost-centers'>) => {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const result = await listCostCenters(companyId);
  return NextResponse.json(result.ok ? result.data : []);
});

export const POST = withErrorHandling("/api/companies/[companyId]/cost-centers", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/cost-centers'>) => {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.SETTINGS_MANAGE);
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  const parsed = NewCostCenterSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 422 });

  const result = await createCostCenter(companyId, parsed.data.code, parsed.data.name, parsed.data.departmentId);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
});
