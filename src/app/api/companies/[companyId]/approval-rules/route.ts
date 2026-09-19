import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { createApprovalRule, listApprovalRules } from '@/server/services/procurement.service';
import { NewApprovalRuleSchema } from '@/server/validation/procurement';
import { withErrorHandling } from '@/server/errors';

export const GET = withErrorHandling("/api/companies/[companyId]/approval-rules", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/approval-rules'>) => {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId);
  if (!access.ok) return access.response;

  const result = await listApprovalRules(companyId);
  return NextResponse.json(result.ok ? result.data : []);
});

export const POST = withErrorHandling("/api/companies/[companyId]/approval-rules", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/approval-rules'>) => {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.SETTINGS_MANAGE);
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  const parsed = NewApprovalRuleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 422 });

  const result = await createApprovalRule({ ...parsed.data, companyId });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json(result.data);
});
