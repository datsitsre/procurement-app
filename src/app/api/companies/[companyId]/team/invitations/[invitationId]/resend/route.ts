import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { resendInvitation } from '@/server/services/invitation.service';
import { withErrorHandling } from '@/server/errors';

/** Resends a pending invitation (Part 12) - regenerates its token/expiry in place, invalidating
 *  the previous link. Same USERS_MANAGE permission as creating one. `invitationId` is checked
 *  against `companyId` inside resendInvitation itself, the same tenant-scoping every other
 *  team-member action in this app uses. */
export const POST = withErrorHandling("/api/companies/[companyId]/team/invitations/[invitationId]/resend", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/team/invitations/[invitationId]/resend'>) => {
  const { companyId, invitationId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.USERS_MANAGE);
  if (!access.ok) return access.response;

  const result = await resendInvitation(companyId, invitationId, { userId: access.auth.userId, name: access.auth.userName });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: result.error.code === 'NOT_FOUND' ? 404 : result.error.code === 'CONFLICT' ? 409 : 422 });
  return NextResponse.json(result.data);
});
