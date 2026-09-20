import { NextResponse, type NextRequest } from 'next/server';
import { PLATFORM_ROLES } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { getPlatformOverview } from '@/server/services/platformOverview.service';
import { withErrorHandling } from '@/server/errors';

/** The Platform Command Center dashboard's one data fetch (/admin). No single `Permission` gates
 *  this route itself - any authenticated platform-tier session (PLATFORM_MANAGER, PLATFORM_ADMIN,
 *  PLATFORM_SUPER_ADMIN) may call it, the same boundary AdminGuard already enforces client-side
 *  for the page itself - but every *section* of the response is independently permission-checked
 *  inside getPlatformOverview() against the caller's own real, session-derived role, never a
 *  client-supplied one. An ordinary company/supplier user (no platform role at all) is rejected
 *  here with a 403 before any query runs. */
export const GET = withErrorHandling("/api/admin/overview", async (request: NextRequest) => {
  const access = await requireAuthenticated(request);
  if (!access.ok) return access.response;

  if (!access.auth.role || !PLATFORM_ROLES.includes(access.auth.role)) {
    return NextResponse.json({ error: 'This overview is only available to platform administrators.' }, { status: 403 });
  }

  const overview = await getPlatformOverview({ role: access.auth.role });
  return NextResponse.json(overview);
});
