import { NextResponse, type NextRequest } from 'next/server';
import { Permission, type Role } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { requestTeamMemberPasswordReset } from '@/server/services/company.service';
import { withErrorHandling } from '@/server/errors';

/** Triggers a password reset for a team member on the caller's own company (Part B6). Returns
 *  the raw reset token/link exactly once, the same "no email delivery, show once" pattern
 *  addTeamMember's temporaryPassword already established - the admin shares it with the team
 *  member out of band, who then completes the reset themselves at
 *  POST /api/auth/reset-password (never the admin setting a password directly). */
export const POST = withErrorHandling("/api/companies/[companyId]/team/[userId]/reset-password", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/team/[userId]/reset-password'>) => {
  const { companyId, userId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.USERS_MANAGE);
  if (!access.ok) return access.response;

  const result = await requestTeamMemberPasswordReset(companyId, userId, { userId: access.auth.userId, role: access.auth.role as Role });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: result.error.code === 'NOT_FOUND' ? 404 : 422 });
  return NextResponse.json(result.data);
});
