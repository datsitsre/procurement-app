import { NextResponse, type NextRequest } from 'next/server';
import { Permission, type Role } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { setTeamMemberStatus } from '@/server/services/company.service';
import { withErrorHandling } from '@/server/errors';

/** Suspends a team member within the caller's own company (Part B7 - Company User Management).
 *  Same USERS_MANAGE permission as editing a member - there is no separate "suspend" permission
 *  in this app's RBAC (confirmed by inspection). `companyId` comes from the URL but is never
 *  trusted alone - requireCompanyAccess re-derives the caller's real tenant from their session
 *  and only proceeds if it matches, the same IDOR protection every other /api/companies/[companyId]/*
 *  route already relies on. */
export const POST = withErrorHandling("/api/companies/[companyId]/team/[userId]/suspend", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/team/[userId]/suspend'>) => {
  const { companyId, userId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.USERS_MANAGE);
  if (!access.ok) return access.response;

  const result = await setTeamMemberStatus(companyId, userId, 'SUSPENDED', { userId: access.auth.userId, role: access.auth.role as Role });
  if (!result.ok) {
    const status =
      result.error.code === 'NOT_FOUND'
        ? 404
        : result.error.code === 'CONFLICT'
          ? 409
          : result.error.code === 'SELF_SUSPEND_DENIED' || result.error.code === 'OWNER_ROLE_RESTRICTED' || result.error.code === 'LAST_OWNER_PROTECTED'
            ? 403
            : 422;
    return NextResponse.json({ error: result.error.message }, { status });
  }
  return NextResponse.json(result.data);
});
