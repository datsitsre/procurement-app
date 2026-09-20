import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { activateCompany } from '@/server/services/company.service';
import { withErrorHandling } from '@/server/errors';

/** Reactivates a suspended company (Phase 28 follow-up - Company Organization Management).
 *  Gated on PLATFORM_COMPANIES_ACTIVATE (Super Admin/legacy Admin only - never
 *  PLATFORM_MANAGER). See suspend/route.ts's own comment for the shared reasoning. */
export const POST = withErrorHandling("/api/admin/companies/[companyId]/activate", async (request: NextRequest, ctx: RouteContext<'/api/admin/companies/[companyId]/activate'>) => {
  const access = await requireAuthenticated(request, Permission.PLATFORM_COMPANIES_ACTIVATE);
  if (!access.ok) return access.response;

  const { companyId } = await ctx.params;
  const result = await activateCompany(companyId, { userId: access.auth.userId, name: access.auth.userName });
  if (!result.ok) {
    const status = result.error.code === 'CONFLICT' ? 409 : result.error.code === 'NOT_FOUND' ? 404 : 422;
    return NextResponse.json({ error: result.error.message }, { status });
  }
  return NextResponse.json(result.data);
});
