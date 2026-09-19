import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { listPlatformUsers } from '@/server/services/platformUsers.service';
import { withErrorHandling } from '@/server/errors';

/** The platform's own user-administration queue (Phase 26) - pending registrations, rejected/
 *  suspended memberships, and anyone holding a platform-tier role. Available to both
 *  PLATFORM_MANAGER and PLATFORM_SUPER_ADMIN (and the legacy PLATFORM_ADMIN) - viewing this queue
 *  is a platform-operations function, not a company-transaction one. See
 *  platformUsers.service.ts's own comment for why this deliberately isn't "every user at every
 *  company." */
export const GET = withErrorHandling("/api/admin/platform/users", async (request: NextRequest) => {
  const access = await requireAuthenticated(request, Permission.PLATFORM_USERS_MANAGE);
  if (!access.ok) return access.response;

  const result = await listPlatformUsers();
  return NextResponse.json(result.ok ? result.data : []);
});
