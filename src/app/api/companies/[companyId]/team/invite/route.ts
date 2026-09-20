import { NextResponse, type NextRequest } from 'next/server';
import { Permission, type Role } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { inviteTeamMember } from '@/server/services/invitation.service';
import { NewInvitationSchema } from '@/server/validation/company';
import { withErrorHandling } from '@/server/errors';

/** Invites someone to the caller's own company (Real Company User Invitation + Onboarding phase)
 *  - replaces addTeamMember as the Team page's primary "Add User" action. Same USERS_MANAGE
 *  permission and companyId-from-session-tenant pattern every other team route already uses -
 *  `companyId` in the URL is never trusted alone (requireCompanyAccess). Listing pending
 *  invitations lives at GET /api/companies/[companyId]/team/invitations. */
export const POST = withErrorHandling("/api/companies/[companyId]/team/invite", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/team/invite'>) => {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.USERS_MANAGE);
  if (!access.ok) return access.response;

  const body = await request.json().catch(() => null);
  const parsed = NewInvitationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const result = await inviteTeamMember(companyId, parsed.data, { userId: access.auth.userId, name: access.auth.userName, role: access.auth.role as Role });
  if (!result.ok) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : result.error.code === 'OWNER_ROLE_RESTRICTED' ? 403 : result.error.code === 'ALREADY_MEMBER' || result.error.code === 'INVITATION_ALREADY_PENDING' ? 409 : 422;
    return NextResponse.json({ error: result.error.message }, { status });
  }
  return NextResponse.json(result.data);
});
