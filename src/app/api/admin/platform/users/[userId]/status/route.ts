import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { setMembershipStatus } from '@/server/services/platformUsers.service';
import { SetMembershipStatusSchema } from '@/server/validation/platformUsers';
import { withErrorHandling } from '@/server/errors';

/** Suspend or reactivate an already-decided membership (Phase 26) - distinct from the
 *  registration route above, and distinct from PLATFORM_REGISTRATION_APPROVE, so a platform
 *  admin who can approve new signups isn't automatically also able to suspend existing accounts
 *  (or the reverse) without both permissions actually being granted. */
export const PATCH = withErrorHandling("/api/admin/platform/users/[userId]/status", async (request: NextRequest, ctx: RouteContext<'/api/admin/platform/users/[userId]/status'>) => {
  const access = await requireAuthenticated(request, Permission.PLATFORM_USERS_MANAGE);
  if (!access.ok) return access.response;

  const { userId } = await ctx.params;
  const body = await request.json().catch(() => null);
  const parsed = SetMembershipStatusSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 422 });

  if (!access.auth.role) return NextResponse.json({ error: 'No active role.' }, { status: 403 });

  const result = await setMembershipStatus(userId, parsed.data.companyId, parsed.data.status, {
    userId: access.auth.userId,
    role: access.auth.role,
    name: access.auth.userName,
  });
  if (!result.ok) {
    const status = result.error.code === 'CONFLICT' ? 409 : result.error.code === 'NOT_FOUND' ? 404 : result.error.code === 'FORBIDDEN' || result.error.code === 'SELF_STATUS_CHANGE_DENIED' ? 403 : 422;
    return NextResponse.json({ error: result.error.message }, { status });
  }
  return NextResponse.json(result.data);
});
