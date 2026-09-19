import { NextResponse, type NextRequest } from 'next/server';
import { Permission, Role } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { setSpendingLimit } from '@/server/services/company.service';
import { SetSpendingLimitSchema } from '@/server/validation/company';
import { withErrorHandling } from '@/server/errors';

export const PATCH = withErrorHandling("/api/companies/[companyId]/spending-limits/[role]", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/spending-limits/[role]'>) => {
  const { companyId, role } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.SETTINGS_MANAGE);
  if (!access.ok) return access.response;

  if (!Object.values(Role).includes(role as Role)) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 422 });
  }

  const body = await request.json().catch(() => null);
  const parsed = SetSpendingLimitSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 422 });

  const result = await setSpendingLimit(companyId, role as Role, parsed.data.amount);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 422 });
  return NextResponse.json({ ok: true });
});
