import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { getUserDetailForAdmin } from '@/server/services/platformUsers.service';
import { withErrorHandling } from '@/server/errors';

/** One user's full cross-company picture for the User Detail page (Platform Users Management
 *  follow-up) - every membership (platform, buyer, supplier) they hold, never just a summary row.
 *  Same PLATFORM_USERS_MANAGE gate as the directory list - see that route's own comment. */
export const GET = withErrorHandling("/api/admin/users/[userId]", async (request: NextRequest, ctx: RouteContext<'/api/admin/users/[userId]'>) => {
  const access = await requireAuthenticated(request, Permission.PLATFORM_USERS_MANAGE);
  if (!access.ok) return access.response;

  const { userId } = await ctx.params;
  const result = await getUserDetailForAdmin(userId);
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 404 });
  return NextResponse.json(result.data);
});
