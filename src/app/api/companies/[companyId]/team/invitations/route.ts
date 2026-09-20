import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireCompanyAccess } from '@/server/auth/require';
import { listPendingInvitations } from '@/server/services/invitation.service';
import { withErrorHandling } from '@/server/errors';

/** This company's own not-yet-accepted invitations - the Team page's "Pending Invitations"
 *  section. Same USERS_MANAGE permission and tenant-scoping as everything else under
 *  /api/companies/[companyId]/team/*. Never includes the raw token or its hash. */
export const GET = withErrorHandling("/api/companies/[companyId]/team/invitations", async (request: NextRequest, ctx: RouteContext<'/api/companies/[companyId]/team/invitations'>) => {
  const { companyId } = await ctx.params;
  const access = await requireCompanyAccess(request, companyId, Permission.USERS_MANAGE);
  if (!access.ok) return access.response;

  const result = await listPendingInvitations(companyId);
  return NextResponse.json(result.ok ? result.data : []);
});
