import { NextResponse, type NextRequest } from 'next/server';
import { Permission, type Role } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { offboardTeamMember } from '@/server/services/company.service';
import { withErrorHandling } from '@/server/errors';

/** Offboards a team member within the caller's own company (Part B8). Never deletes the User
 *  record or any historical business record - see offboardTeamMember's own comment for exactly
 *  what this does and does not change. */
export const POST = withErrorHandling("/api/companies/[companyId]/team/[userId]/offboard", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/team/[userId]/offboard'>) => {
  const { companyId, userId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.USERS_MANAGE);
  if (!access.ok) return access.response;

  const result = await offboardTeamMember(companyId, userId, { userId: access.auth.userId, role: access.auth.role as Role });
  if (!result.ok) {
    const status =
      result.error.code === 'NOT_FOUND'
        ? 404
        : result.error.code === 'CONFLICT'
          ? 409
          : result.error.code === 'SELF_OFFBOARD_DENIED' || result.error.code === 'OWNER_ROLE_RESTRICTED' || result.error.code === 'LAST_OWNER_PROTECTED'
            ? 403
            : 422;
    return NextResponse.json({ error: result.error.message }, { status });
  }
  return NextResponse.json(result.data);
});
