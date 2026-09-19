import { NextResponse, type NextRequest } from 'next/server';
import { Permission, type Role } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { changePlatformRole } from '@/server/services/platformUsers.service';
import { ChangePlatformRoleSchema } from '@/server/validation/platformUsers';
import { withErrorHandling } from '@/server/errors';

/** Change someone's platform-tier role (Phase 26). Gated on PLATFORM_ROLES_MANAGE, held only by
 *  PLATFORM_SUPER_ADMIN and the legacy PLATFORM_ADMIN - PLATFORM_MANAGER never holds this
 *  permission at all, so it never even reaches changePlatformRole's own second layer of the same
 *  guard (canAssignPlatformRole). Both layers exist deliberately - see that function's own
 *  comment on why it re-derives the check itself rather than trusting this route alone. */
export const PATCH = withErrorHandling("/api/admin/platform/users/[userId]/role", async (request: NextRequest, ctx: RouteContext<'/api/admin/platform/users/[userId]/role'>) => {
  const access = await requireAuthenticated(request, Permission.PLATFORM_ROLES_MANAGE);
  if (!access.ok) return access.response;

  const { userId } = await ctx.params;
  const body = await request.json().catch(() => null);
  const parsed = ChangePlatformRoleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 422 });

  const result = await changePlatformRole(userId, parsed.data.companyId, parsed.data.role as Role, {
    userId: access.auth.userId,
    role: access.auth.role as Role,
    name: access.auth.userName,
  });
  if (!result.ok) {
    const status = result.error.code === 'NOT_FOUND' ? 404 : result.error.code === 'SELF_ROLE_CHANGE_DENIED' || result.error.code === 'FORBIDDEN' ? 403 : 422;
    return NextResponse.json({ error: result.error.message }, { status });
  }
  return NextResponse.json(result.data);
});
