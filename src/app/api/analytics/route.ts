import { NextResponse, type NextRequest } from 'next/server';
import { Permission } from '@/config/rbac';
import { requireAuthenticated } from '@/server/auth/require';
import { getPlatformAnalytics } from '@/server/services/analytics.service';
import { withErrorHandling } from '@/server/errors';

/** The platform admin overview across every company (section 46). */
export const GET = withErrorHandling("/api/analytics", async (request: NextRequest) => {
  const access = await requireAuthenticated(request, Permission.PLATFORM_MANAGE);
  if (!access.ok) return access.response;

  const result = await getPlatformAnalytics();
  if (!result.ok) return NextResponse.json({ error: result.error.message }, { status: 500 });
  return NextResponse.json(result.data);
});
