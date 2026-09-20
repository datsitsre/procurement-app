import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { revokeInvitation } from '@/server/services/invitation.service';
import { withErrorHandling } from '@/server/errors';

/** Revokes a pending invitation (Part 13) - the token stops working immediately, and the
 *  invitation row itself is kept (never deleted) so its audit history and the fact it was
 *  revoked remain visible. Same USERS_MANAGE permission and tenant-scoping as resend. */
export const POST = withErrorHandling("/api/companies/[companyId]/team/invitations/[invitationId]/revoke", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/team/invitations/[invitationId]/revoke'>) => {
  const { companyId, invitationId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.USERS_MANAGE);
  if (!access.ok) return access.response;

  const result = await revokeInvitation(companyId, invitationId, { userId: access.auth.userId, name: access.auth.userName });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: result.error.code === 'NOT_FOUND' ? 404 : result.error.code === 'CONFLICT' ? 409 : 422 });
  return NextResponse.json(result.data);
});
