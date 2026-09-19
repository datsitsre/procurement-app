import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { decideRegistration } from '@/server/services/platformUsers.service';
import { DecideRegistrationSchema } from '@/server/validation/platformUsers';
import { withErrorHandling } from '@/server/errors';

/** Approve or reject a pending self-registration (Phase 26). Gated on
 *  PLATFORM_REGISTRATION_APPROVE - held by both PLATFORM_MANAGER and PLATFORM_SUPER_ADMIN (and
 *  the legacy PLATFORM_ADMIN), since deciding whether a new company gets to exist at all is a
 *  platform-operations function, not access to that company's (not-yet-existing) transactions. */
export const PATCH = withErrorHandling("/api/admin/platform/users/[userId]/registration", async (request: NextRequest, ctx: RouteContext<'/api/admin/platform/users/[userId]/registration'>) => {
  const access = await requireAuthenticated(request, Permission.PLATFORM_REGISTRATION_APPROVE);
  if (!access.ok) return access.response;

  const { userId } = await ctx.params;
  const body = await request.json().catch(() => null);
  const parsed = DecideRegistrationSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request.' }, { status: 422 });

  const result = await decideRegistration(userId, parsed.data.companyId, parsed.data.decision, {
    userId: access.auth.userId,
    name: access.auth.userName,
  });
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: result.error.code === 'NOT_FOUND' ? 404 : 409 });
  return NextResponse.json(result.data);
});
