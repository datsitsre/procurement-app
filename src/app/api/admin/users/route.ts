import { NextResponse, type NextRequest } from 'next/server';
import { Permission, Role } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { listAllUsersForAdmin, type UserDirectoryFilters } from '@/server/services/platformUsers.service';
import { withErrorHandling } from '@/server/errors';

/** The platform-wide user directory (Platform Users Management follow-up) - every registered
 *  user, every company, unlike the narrower moderation queue at GET /api/admin/platform/users
 *  (see platformUsers.service.ts's own top comment for why both exist side by side). Same
 *  PLATFORM_USERS_MANAGE permission as that narrower queue - this is a read-only, broader view of
 *  the same "can this account administer people" capability, not a new authorization boundary. */
export const GET = withErrorHandling("/api/admin/users", async (request: NextRequest) => {
  const access = await requireAuthenticated(request, Permission.PLATFORM_USERS_MANAGE);
  if (!access.ok) return access.response;

  const params = request.nextUrl.searchParams;
  const roleParam = params.get('role');
  const filters: UserDirectoryFilters = {
    search: params.get('search') ?? undefined,
    role: roleParam && (Object.values(Role) as string[]).includes(roleParam) ? (roleParam as Role) : undefined,
    status: params.get('status') ?? undefined,
    companyId: params.get('companyId') ?? undefined,
    sort: (params.get('sort') as UserDirectoryFilters['sort']) ?? undefined,
  };

  const result = await listAllUsersForAdmin(filters);
  return NextResponse.json(result.ok ? result.data : []);
});
