import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { suspendCompany } from '@/server/services/company.service';
import { withErrorHandling } from '@/server/errors';

/** Suspends a company (Phase 28 follow-up - Company Organization Management). Gated on
 *  PLATFORM_COMPANIES_SUSPEND (Super Admin/legacy Admin only - never PLATFORM_MANAGER).
 *  Enforcement of what "suspended" actually means for the company's own users lives centrally
 *  in resolveTenant (server/auth/context.ts), not here - this route only flips the status and
 *  records the audit entry. */
export const POST = withErrorHandling("/api/admin/companies/[companyId]/suspend", async (request: NextRequest, ctx: RouteContext<'/api/admin/companies/[companyId]/suspend'>) => {
  const access = await requireAuthenticated(request, Permission.PLATFORM_COMPANIES_SUSPEND);
  if (!access.ok) return access.response;

  const { companyId } = await ctx.params;
  const result = await suspendCompany(companyId, { userId: access.auth.userId, name: access.auth.userName });
  if (!result.ok) {
    const status = result.error.code === 'CONFLICT' ? 409 : result.error.code === 'NOT_FOUND' ? 404 : 422;
    return NextResponse.json({ error: result.error.message }, { status });
  }
  return NextResponse.json(result.data);
});
