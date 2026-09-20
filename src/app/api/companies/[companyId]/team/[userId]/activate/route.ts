import { NextResponse, type NextRequest } from 'next/server';
import { Permission, type Role } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { setTeamMemberStatus } from '@/server/services/company.service';
import { withErrorHandling } from '@/server/errors';

/** Reactivates a suspended (or offboarded - see offboardTeamMember's own comment on why both
 *  transitions share this one status) team member within the caller's own company. Same
 *  USERS_MANAGE permission as suspend/edit. */
export const POST = withErrorHandling("/api/companies/[companyId]/team/[userId]/activate", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/team/[userId]/activate'>) => {
  const { companyId, userId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.USERS_MANAGE);
  if (!access.ok) return access.response;

  const result = await setTeamMemberStatus(companyId, userId, 'ACTIVE', { userId: access.auth.userId, role: access.auth.role as Role });
  if (!result.ok) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : result.error.code === 'CONFLICT' ? 409 : 422;
    return NextResponse.json({ error: result.error.message }, { status });
  }
  return NextResponse.json(result.data);
});
