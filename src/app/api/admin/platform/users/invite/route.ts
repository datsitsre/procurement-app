import { NextResponse, type NextRequest } from 'next/server';
import { Permission, type Role } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { invitePlatformUser } from '@/server/services/invitation.service';
import { NewPlatformInvitationSchema } from '@/server/validation/platformUsers';
import { withErrorHandling } from '@/server/errors';

/** Invites someone to a platform-tier role (Part X - Add Platform User). Gated on
 *  PLATFORM_ROLES_MANAGE (Super Admin/legacy Admin only - PLATFORM_MANAGER never holds this,
 *  same boundary changePlatformRole already enforces), so a Platform Manager or any company user
 *  gets a 403 before any query runs. The "company" an invited platform user joins is always the
 *  actor's own platform-type Company (Platform Headquarters), resolved from
 *  `access.auth.activeCompanyId` - the session's own raw tenant id, never a client-supplied one
 *  (a platform-admin session's `tenant.companyId` is deliberately empty - see
 *  server/auth/context.ts's resolveTenant - so this route reads the raw session field instead,
 *  the same one /api/session/switch-company already relies on). */
export const POST = withErrorHandling("/api/admin/platform/users/invite", async (request: NextRequest) => {
  const access = await requireAuthenticated(request, Permission.PLATFORM_ROLES_MANAGE);
  if (!access.ok) return access.response;

  if (!access.auth.activeCompanyId) {
    return NextResponse.json({ error: 'No active platform account to invite from.' }, { status: 422 });
  }

  const body = await request.json().catch(() => null);
  const parsed = NewPlatformInvitationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.', fieldErrors: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const result = await invitePlatformUser(access.auth.activeCompanyId, parsed.data, {
    userId: access.auth.userId,
    name: access.auth.userName,
    role: access.auth.role as Role,
  });
  if (!result.ok) {
    const status = result.error.code === 'FORBIDDEN' ? 403 : result.error.code === 'NOT_FOUND' ? 404 : result.error.code === 'ALREADY_MEMBER' || result.error.code === 'INVITATION_ALREADY_PENDING' ? 409 : 422;
    return NextResponse.json({ error: result.error.message }, { status });
  }
  return NextResponse.json(result.data);
});
